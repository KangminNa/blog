import {
  type Actor,
  Command,
  Operation,
  Rule,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { CLICK_TARGET, clickDone, LOGIN_ACTION, PUBLISH_ACTION, SITE_TARGET } from './job';
import { clicks, sites } from './schema';
import { ConfirmedView } from './views';

// 코어의 결재 · 작업 이벤트를 받는 동작 (코어가 서버 자신으로 트랜잭션 하나에서 돌린다). 두 번 와도 결과가 같다.
//   클릭 결재(browser.site.publish, 대상 browser_click): 승인 → 클릭 approved (붙잡은 러너가 누른다),
//     수정 요청 · 반려 · 취소 → dropped (수정 요청이면 AI가 붙잡아 둔 탭에서 다시 고친다)
//   로그인 결재(browser.site.login, 대상 browser_site): "로그인했어요"(수정 요청) → 사이트의 로그인 필요 표시를 비운다.
//     같은 작업이 대기열로 돌아가 처음부터 이어서 한다. 승인은 쓰지 않는 길이라 실패로 끝낸다
//   작업이 실패 · 취소로 끝나면 그 작업의 붙잡힌 · 승인된 클릭을 닫는다 (취소된 작업의 버튼을 누르지 않게)

/** 결재 이벤트의 결정: 승인 · 수정 요청 · 그 밖에 닫힘(반려 · 취소) */
export type Decision = 'granted' | 'revised' | 'closed';

type DecidedInput = {
  approvalId: string;
  action: string;
  spaceId: string;
  targetKind: string | null;
  targetId: string | null;
  targetVersion: number | null;
};

/** task.approval.granted · revision_requested · rejected · cancelled 하나 */
export class ApprovalDecided extends Command<DecidedInput> {
  readonly name: string;
  readonly allow = Operation.SYSTEM;

  constructor(private readonly decision: Decision) {
    super();
    this.name = `approval-${decision}`;
  }

  input(raw: unknown): DecidedInput {
    const r = (raw ?? {}) as { targetKind?: unknown; targetId?: unknown; targetVersion?: unknown };
    return this.fields(raw, (f) => ({
      approvalId: f.uuid('approvalId'),
      action: f.text('action', 100),
      spaceId: f.uuid('spaceId'),
      targetKind: typeof r.targetKind === 'string' ? f.text('targetKind', 40) : null,
      targetId: typeof r.targetId === 'string' ? f.uuid('targetId') : null,
      targetVersion:
        typeof r.targetVersion === 'number' ? f.integer('targetVersion', 0, 2_147_483_647) : null,
    }));
  }

  async run(work: Work, _actor: Actor, input: DecidedInput): Promise<ConfirmedView> {
    if (input.action === PUBLISH_ACTION) await this.click(work, input);
    else if (input.action === LOGIN_ACTION) await this.login(work, input);
    else return new ConfirmedView(false);
    return new ConfirmedView(true);
  }

  private async click(work: Work, input: DecidedInput): Promise<void> {
    const row =
      input.targetKind === CLICK_TARGET && input.targetId
        ? await work.row(clicks, { id: input.targetId, space_id: input.spaceId })
        : null;
    const pending = row?.status === 'held' && row.version === input.targetVersion;
    if (this.decision !== 'granted') {
      if (row && pending)
        await work.updateRows(
          clicks,
          {
            status: 'dropped',
            approval_id: input.approvalId,
            decided_at: Rule.now,
            version: row.version + 1,
          },
          { id: row.id, version: row.version },
        );
      return;
    }
    // 1차의 "직접 발행했어요"(대상 browser_site)나 이미 닫힌 클릭은 누를 것이 없다
    if (!row || !pending)
      return clickDone(
        work,
        input.spaceId,
        input.approvalId,
        '결재한 클릭이 아니에요 (이미 닫혔거나 바뀌었어요)',
      );
    await work.updateRows(
      clicks,
      {
        status: 'approved',
        approval_id: input.approvalId,
        decided_at: Rule.now,
        version: row.version + 1,
      },
      { id: row.id, version: row.version },
    );
  }

  private async login(work: Work, input: DecidedInput): Promise<void> {
    if (this.decision === 'granted')
      return clickDone(
        work,
        input.spaceId,
        input.approvalId,
        '로그인 결재는 "로그인했어요"로 이어 가요',
      );
    if (this.decision === 'revised' && input.targetKind === SITE_TARGET && input.targetId)
      await work.updateRows(
        sites,
        { login_needed_at: null },
        { id: input.targetId, space_id: input.spaceId },
      );
  }
}

type SettledInput = { taskId: string; status: string; spaceId: string };

/** task.task.changed: 실패 · 취소로 끝난 작업의 열린 클릭(붙잡음 · 승인됨)을 닫는다 */
export class TaskSettled extends Command<SettledInput> {
  private static readonly ENDED = ['failed', 'cancelled'];
  readonly name = 'taskSettled';
  readonly allow = Operation.SYSTEM;

  input(raw: unknown): SettledInput {
    return this.fields(raw, (f) => ({
      taskId: f.uuid('taskId'),
      status: f.text('status', 20),
      spaceId: f.uuid('spaceId'),
    }));
  }

  async run(work: Work, _actor: Actor, input: SettledInput): Promise<ConfirmedView> {
    if (!TaskSettled.ENDED.includes(input.status)) return new ConfirmedView(false);
    const open = await work.rows(clicks, {
      space_id: input.spaceId,
      task_id: input.taskId,
      status: ['held', 'approved'],
    });
    for (const row of open)
      await work.updateRows(
        clicks,
        { status: 'dropped', reason: '작업이 끝났어요', version: row.version + 1 },
        { id: row.id, version: row.version },
      );
    return new ConfirmedView(open.length > 0);
  }
}
