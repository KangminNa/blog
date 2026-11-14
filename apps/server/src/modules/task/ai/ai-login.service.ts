import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseService,
  Database,
  Forbidden,
  NotFound,
  RuleViolation,
  SecretBox,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { RunnerRepository } from '../runner/runner.repository';
import { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import { AiLogin } from './ai-login';
import type {
  AiLoginInput,
  AiLoginRefreshInput,
  AiSigninCodeInput,
  AiSigninInput,
  AiSigninStepInput,
  AiTokenInput,
} from './ai-login.input';
import { AiLoginQuery } from './ai-login.query';
import { AiLoginRepository } from './ai-login.repository';
import type { AiSigninRelayView, AiTokenView } from './ai-login.view';
import { AiSigninPolicy } from './ai-signin.policy';

// AI 로그인 쓰기: 토큰 넣기, 연결 확인 맡기기(주인), 서버 키를 바꾼 뒤 다시 잠그기, 러너에게 건네기(ai_login),
// 웹 로그인(주인이 시작하고 코드를 넣고, 러너가 로그인 명령을 대신 돌려 주소를 알리고 자격을 넘긴다).
// 웹 로그인은 서버 본체에 CLI가 없어서(원칙 6) 연결 확인처럼 러너에게 작업으로 맡긴다. 웹 터미널은 아니다:
// 오가는 것은 로그인 주소, 사람이 붙여 넣은 코드 하나, 받은 자격뿐이다.
// 확인 결과는 작업이 끝날 때 TaskService가 같은 트랜잭션에서 적는다. 잠그는 순서는 작업 → 로그인.
@Injectable()
export class AiLoginService extends BaseService {
  /** 사람이 붙여 넣은 코드는 이만큼만 (암호화해 작업에 둔다) */
  private static readonly CODE_SECONDS = 600;
  /**
   * 코드를 쌀 때 앞에 붙이는 용도. SecretBox.pack은 작업 토큰 · 설치 통행증과 열쇠가 같아서,
   * 주인이 고른 글을 그대로 싸면 다른 용도의 값으로 풀릴 수 있다
   */
  private static readonly CODE_PURPOSE = 'ai-signin-code';

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly logins: AiLoginQuery,
  ) {
    super(db);
  }

  /**
   * ai_login: 러너에게 토큰을 건넨다 (읽기는 AiLoginQuery.token). 그 전에 러너가 닿은 때를 남긴다:
   * 할 수 있는 것을 알리기 전의 러너는 토큰이 없는 동안 이것만 묻는다. 토큰이 없어 거절해도 닿은 때는 남는다
   */
  async handOver(actor: Actor, req: AiLoginInput): Promise<AiTokenView> {
    actor.assertCan(Actor.RUN);
    const { spaceId, id } = actor;
    if (actor.kind !== 'device' || !spaceId || !id) throw new Forbidden(Actor.RUN);
    await this.transaction((tx) =>
      new RunnerRepository(tx).seen(spaceId, id, new Date(), actor.inSandbox()),
    );
    return this.logins.token(actor, req);
  }

  /** Claude 토큰을 넣거나 바꾼다 */
  async saveToken(actor: Actor, req: AiTokenInput): Promise<AiLogin> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const sealed = this.box.seal(req.token);
    const now = new Date();
    return this.transaction(async (tx) => {
      const logins = new AiLoginRepository(tx);
      const found = await logins.lockTool(spaceId, AiLogin.CLAUDE);
      found?.replace(sealed, now);
      const login = found ?? AiLogin.open(spaceId, AiLogin.CLAUDE, sealed, now);
      await logins.save(login);
      return login;
    });
  }

  /**
   * 연결 확인을 맡긴다. 서버 본체에는 AI가 없어 러너가 돈다. 로그인 줄을 잠가서, 여러 번 눌러도 기다리는 확인은 하나다.
   * 작업은 확인할 로그인의 판을 들고 간다: 도는 사이 토큰을 바꾸면 옛 토큰의 결과를 새 토큰에 적지 않는다.
   */
  async test(actor: Actor): Promise<Task> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const login = await new AiLoginRepository(tx).lockTool(spaceId, AiLogin.CLAUDE);
      if (!login) throw new RuleViolation('토큰을 먼저 넣어 주세요');
      login.assertUsable(now);
      const tasks = new TaskRepository(tx);
      const pending = await tasks.findPendingAiTest(spaceId, login.tool);
      if (pending) return pending;
      const task = Task.aiTest(spaceId, login.tool, login.version, now);
      await tasks.insertOnce(task);
      return task;
    });
  }

  /** 웹 로그인을 시작한다. 도구마다 하나: 진행 중인 로그인이 있으면 그 작업을 돌려준다 */
  async startSignin(actor: Actor, req: AiSigninInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    AiLogin.assertTool(req.tool);
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      await tasks.lockSigninSlot(spaceId, req.tool);
      const pending = await tasks.findPendingAiSignin(spaceId, req.tool);
      if (pending) return pending;
      const task = Task.aiSignin(spaceId, req.tool, new Date());
      await tasks.insertOnce(task);
      return task;
    });
  }

  /** 주인이 브라우저에서 받은 코드 (Claude). 암호화해서 러너가 가져갈 때까지만 둔다 */
  async submitSigninCode(actor: Actor, req: AiSigninCodeInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    AiSigninPolicy.assertBrowserCode(req.code);
    const sealed = this.box.pack(
      AiLoginService.CODE_PURPOSE,
      req.code,
      AiLoginService.CODE_SECONDS,
    );
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, req.taskId);
      if (task.signinTool !== AiLogin.CLAUDE)
        throw new RuleViolation('코드를 붙여 넣는 로그인이 아니에요');
      task.acceptSigninCode(sealed);
      await tasks.save(task);
      return task;
    });
  }

  /**
   * ai_signin (러너): 로그인 주소를 알리고, 사람이 붙여 넣은 코드를 받고(끝날 때까지 물을 때마다), 받은 자격을 넘긴다.
   * 그 작업의 임대를 쥔 러너만. 자격을 받으면 같은 트랜잭션에서 로그인에 저장하고 작업을 끝낸다 (잠그는 순서는 작업 → 로그인).
   * 주인이 취소했으면 cancelled로 알린다
   */
  async relaySignin(actor: Actor, req: AiSigninStepInput): Promise<AiSigninRelayView> {
    actor.assertCan(Actor.RUN);
    const { spaceId, id: runnerId } = actor;
    if (actor.kind !== 'device' || !spaceId || !runnerId) throw new Forbidden(Actor.RUN);
    const now = new Date();
    // 로그인하는 동안 러너는 이것만 부른다. 러너 메뉴에 연결 안 됨으로 보이지 않게 닿은 때를 남긴다
    await this.transaction((tx) =>
      new RunnerRepository(tx).seen(spaceId, runnerId, now, actor.inSandbox()),
    );
    const { task, code } = await this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, req.taskId);
      const tool = task.signinTool;
      if (tool === null) throw new RuleViolation('웹 로그인 작업이 아니에요');
      if (task.cancelled) return { task, code: null };
      // 자격을 넘긴 응답을 잃고 다시 보냈다: 이미 저장했으니 같은 답을 준다
      if (task.signinDoneBy(runnerId)) return { task, code: null };
      task.assertHeldBy(runnerId, now);
      if (req.url !== null) {
        AiSigninPolicy.assertUrl(tool, req.url);
        AiSigninPolicy.assertUserCode(tool, req.userCode);
        task.showSignin(req.url, req.userCode);
      }
      if (req.credential !== null) {
        AiSigninPolicy.assertCredential(tool, req.credential);
        const logins = new AiLoginRepository(tx);
        const found = await logins.lockTool(spaceId, tool);
        const sealed = this.box.seal(req.credential);
        found?.replace(sealed, now);
        await logins.save(found ?? AiLogin.open(spaceId, tool, sealed, now));
        task.finish({}, now);
      }
      const code = task.signinCode;
      await tasks.save(task);
      return { task, code };
    });
    return task.relayView(this.openCode(code, now));
  }

  /**
   * 작업에 둔 코드를 푼다. 10분이 지났거나 이 용도로 싼 값이 아니면 null:
   * 러너는 더 기다리다 시간이 다 되면 실패로 끝낸다
   */
  private openCode(sealed: string | null, now: Date): string | null {
    return this.box.unpack(AiLoginService.CODE_PURPOSE, sealed, now);
  }

  /**
   * ai_login_refresh (러너): 실행하는 동안 CLI가 갱신한 자격을 되돌려 쓴다 (Codex의 auth.json).
   * 그 일을 맡았던 러너만(취소된 뒤에도), 그 일이 쓴 도구만, 받은 판일 때만. 잠그는 순서는 작업 → 로그인
   */
  async refresh(actor: Actor, req: AiLoginRefreshInput): Promise<AiLogin> {
    actor.assertCan(Actor.RUN);
    const { spaceId, id: runnerId } = actor;
    if (actor.kind !== 'device' || !spaceId || !runnerId) throw new Forbidden(Actor.RUN);
    AiLogin.assertRotating(req.tool);
    AiSigninPolicy.assertCredential(req.tool, req.credential);
    const sealed = this.box.seal(req.credential);
    return this.transaction(async (tx) => {
      // 지금 도는 일이 아니어도 된다 (주인이 취소했어도): 이 러너가 맡았던 일이면 받는다
      const task = await new TaskRepository(tx).lock(spaceId, req.taskId);
      task.assertWorkedBy(runnerId);
      // 그 일이 쓴 도구의 로그인만 바꾼다: 다른 도구로 일한 작업의 id로 이 도구의 로그인을 덮지 못하게.
      // 에이전트의 도구는 잠그지 않고 읽는다 (잠그는 순서 작업 → 로그인을 지키고, 도구는 바뀌어도 이 일의 것이 아니다)
      const used = task.agentless
        ? task.testedTool
        : (await new AgentRepository(tx).load(spaceId, task.agentId ?? '')).tool;
      if (used !== req.tool) throw new RuleViolation(`이 작업은 ${req.tool}로 일하지 않았어요`);
      const logins = new AiLoginRepository(tx);
      const login = await logins.lockTool(spaceId, req.tool);
      if (!login) throw new NotFound(`${req.tool} 로그인이 없어요`);
      login.assertVersion(req.version);
      login.refresh(sealed);
      await logins.save(login);
      return login;
    });
  }

  /** 지금 서버 키로 다시 잠근다 (pnpm secret:rotate). 바꾼 수를 돌려준다 */
  async resealSecrets(actor: Actor): Promise<number> {
    actor.assertOwnerOrSystem();
    return this.transaction(async (tx) => {
      const logins = new AiLoginRepository(tx);
      let count = 0;
      for (const login of await logins.lockAll()) {
        if (!login.reseal(this.box)) continue;
        await logins.save(login);
        count += 1;
      }
      return count;
    });
  }
}
