import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  Conflict,
  Database,
  Forbidden,
  Idempotency,
  NotFound,
  RuleViolation,
} from '../../platform';
import { SensitivePolicy } from '../session/sensitive.policy';
import type { DecideChangeInput, EditInput, SubmitChangesInput } from './change.input';
import { ChangeRepository } from './change.repository';
import type { ChangeOp, TargetBoard } from './change-op';
import { ChangeSet } from './change-set';
import { ChangeWork } from './change-target';
import { ReviewPolicy, Verdict } from './review.policy';
import { TargetRepository } from './target.repository';

// 그래프를 바꾸는 쓰기 전부: AI의 정리 결과, 관리 화면 편집, 검토 결정, 되돌리기.
// 여러 데이터 묶음의 Repository를 한 트랜잭션에서 쓰는 단 하나의 Service다 (객체설계 4장 예외).
// 판단은 ReviewPolicy와 엔티티가 하고, 여기서는 잠그고 판정하고 적용하는 순서만 정한다.
@Injectable()
export class ChangeService extends BaseService {
  private static readonly SUBMIT = 'submit_changes';
  private static readonly EDIT = 'edit_changes';

  constructor(
    db: Database,
    private readonly policy: ReviewPolicy,
    private readonly sensitive: SensitivePolicy,
  ) {
    super(db);
  }

  /**
   * AI의 정리 결과 (T4). 묶음 열기 → 대상 잠금 → 변경마다 판정: 바로 합칠 것은 적용, 검토는 기다림, 거부는 이유와 함께.
   * 작업 토큰이면 작업 하나에 묶음 하나(job_id): 러너가 submit_result 전에 죽어 다시 내도 첫 결과를 돌려준다.
   * 기기면 request_id가 중복을 막는다. 작업을 끝내는 일은 하지 않는다 (러너의 submit_result).
   */
  async submit(actor: Actor, req: SubmitChangesInput): Promise<ChangeSet> {
    actor.assertCan(Actor.TIDY);
    const spaceId = ChangeService.spaceOf(actor);
    const scrub = (text: string) => this.sensitive.scrub('wiki', text)[0];
    for (const op of req.ops) op.clean(scrub);
    const jobId = actor instanceof AgentActor ? actor.taskId : null;
    return this.transaction(async (tx) => {
      const sets = new ChangeRepository(tx);
      const once = jobId
        ? null
        : new Idempotency(tx, actor.id ?? spaceId, req.requestId, ChangeService.SUBMIT);
      const first = await ChangeService.firstResult(sets, spaceId, jobId, once);
      if (first) return first;
      const now = new Date();
      const set = ChangeSet.open(
        spaceId,
        ChangeSet.TIDY,
        ChangeWork.actorTypeOf(actor),
        actor.id,
        jobId,
        scrub(req.message),
        req.ops,
        now,
      );
      await sets.begin(set);
      const targets = new TargetRepository(tx, spaceId);
      const board = await targets.lock(set.ops);
      const rules = await sets.rules(spaceId, set.targetCount);
      const work = set.work(now);
      for (const op of set.ops) {
        op.bind(board);
        op.judge(this.policy.judge(op, op.target, rules));
        if (op.applied) await this.apply(op, board, targets, sets, work);
      }
      set.submitted(now);
      await sets.save(set);
      await once?.remember({ changeSetId: set.id });
      return set;
    });
  }

  /**
   * 관리 화면 편집 (T5). 묶음(kind = human)으로 남기되 규칙은 거치지 않고 바로 합친다.
   * version이 어긋나면 Conflict, 대상이 없으면 NotFound. 사람이 고친 칸과 연결은 사람의 것으로 표시된다.
   */
  async edit(actor: Actor, req: EditInput): Promise<ChangeSet> {
    actor.assertOwner();
    const spaceId = ChangeService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const sets = new ChangeRepository(tx);
      const targets = new TargetRepository(tx, spaceId);
      const once = req.requestId
        ? new Idempotency(tx, actor.id ?? spaceId, req.requestId, ChangeService.EDIT)
        : null;
      const first = await ChangeService.firstResult(sets, spaceId, null, once);
      if (first) {
        const board = await targets.lock(first.ops);
        for (const op of first.ops) op.bind(board);
        return first;
      }
      const now = new Date();
      const set = ChangeSet.open(
        spaceId,
        ChangeSet.HUMAN,
        ChangeWork.actorTypeOf(actor),
        actor.id,
        null,
        req.message,
        req.ops,
        now,
      );
      await sets.begin(set);
      const board = await targets.lock(set.ops);
      const work = set.work(now);
      for (const op of set.ops) {
        op.bind(board);
        if (op.missing) throw new NotFound('대상을 찾을 수 없어요');
        if (op.stale)
          throw new Conflict('다른 곳에서 먼저 바뀌었어요. 새로 불러온 뒤 다시 해 주세요');
        op.judge(Verdict.direct());
        await this.apply(op, board, targets, sets, work);
      }
      set.submitted(now);
      await sets.save(set);
      await once?.remember({ changeSetId: set.id });
      return set;
    });
  }

  /**
   * 검토 결정 (T6). 묶음·대상 잠금 → 판정한 뒤 대상이 바뀌었으면 밀려남, 아니면 적용 → 남은 검토가 없으면 묶음을 닫는다.
   * 최신 내용 위에 덮어쓰지 않는다. 승인한 사람은 decided_by, 내용의 주인은 그대로 AI다.
   */
  async decide(
    actor: Actor,
    setId: string,
    seq: number,
    decision: DecideChangeInput,
  ): Promise<ChangeSet> {
    actor.assertOwner();
    const spaceId = ChangeService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const sets = new ChangeRepository(tx);
      const set = await sets.lock(spaceId, setId);
      set.assertVersion(decision.version);
      const op = set.waitingOp(seq);
      const now = new Date();
      if (!decision.approved) {
        op.decline(actor.id, now);
      } else {
        const targets = new TargetRepository(tx, spaceId);
        const board = await targets.lock([op]);
        op.bind(board);
        if (op.missing || op.moved) {
          op.supersede(actor.id, now, '기다리는 사이 대상이 바뀌었어요');
        } else {
          op.approve(actor.id, now);
          await this.apply(op, board, targets, sets, set.work(now, true));
        }
      }
      set.decided(op, now);
      await sets.save(set);
      return set;
    });
  }

  /**
   * 되돌리기 (T7). 기록을 지우지 않고 앞 상태를 적용하는 새 묶음(kind = revert)을 쓴다. 판은 앞 내용을 새 판으로 쌓는다.
   * 그사이 같은 대상이 바뀌었으면 덮어쓰지 않고 Conflict로 멈춘다.
   */
  async revert(actor: Actor, setId: string, version: number): Promise<ChangeSet> {
    actor.assertOwner();
    const spaceId = ChangeService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const sets = new ChangeRepository(tx);
      const original = await sets.lock(spaceId, setId);
      original.assertVersion(version);
      original.assertRevertible();
      const ops = await sets.revertOps(setId);
      if (ops.length === 0) throw new RuleViolation('되돌릴 변경이 없어요');
      const now = new Date();
      const revert = ChangeSet.reverting(original, actor.id, ops, now);
      await sets.begin(revert);
      const targets = new TargetRepository(tx, spaceId);
      const board = await targets.lock(ops);
      const work = revert.work(now);
      for (const op of revert.ops) {
        op.bind(board);
        if (op.missing || op.moved)
          throw new Conflict('이 변경 뒤에 대상이 다시 바뀌었어요. 나중 변경부터 되돌려 주세요');
        op.judge(Verdict.direct());
        await this.apply(op, board, targets, sets, work);
      }
      revert.submitted(now);
      await sets.save(revert);
      original.revertedWith(revert.id, actor.id, now);
      await sets.save(original);
      await sets.markUndone(setId, revert.id);
      return revert;
    });
  }

  /** 앞 상태를 적어 두고 엔티티에 시킨 뒤 저장한다. 바뀐 것이 없으면 기록도 없다 */
  private async apply(
    op: ChangeOp,
    board: TargetBoard,
    targets: TargetRepository,
    sets: ChangeRepository,
    work: ChangeWork,
  ): Promise<void> {
    const before = op.target?.snapshot() ?? null;
    const target = op.apply(work);
    const changed = target.changed || target.isNew;
    await targets.save(target);
    op.settled(target);
    board.keep(op.seq, op.place, target);
    if (changed) await sets.record(work, op, target, before);
  }

  /** 이미 처리한 제출이면 그 묶음. 작업 토큰은 작업으로, 그 밖에는 request_id로 찾는다 */
  private static async firstResult(
    sets: ChangeRepository,
    spaceId: string,
    jobId: string | null,
    once: Idempotency | null,
  ): Promise<ChangeSet | null> {
    if (jobId) return sets.lockJob(spaceId, jobId);
    const before = await once?.previous();
    return before ? sets.load(spaceId, String(before.changeSetId)) : null;
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden('owner');
    return actor.spaceId;
  }
}
