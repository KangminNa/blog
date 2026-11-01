import { Injectable } from '@nestjs/common';
import { Actor, BaseService, Database, Forbidden, RuleViolation, SecretBox } from '../../platform';
import { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import { AiLogin } from './ai-login';
import type { AiTokenInput } from './ai-login.input';
import { AiLoginRepository } from './ai-login.repository';

// AI 로그인 쓰기: 토큰 넣기, 연결 확인 맡기기(주인), 서버 키를 바꾼 뒤 다시 잠그기.
// 확인 결과는 작업이 끝날 때 TaskService가 같은 트랜잭션에서 적는다. 잠그는 순서는 작업 → 로그인.
@Injectable()
export class AiLoginService extends BaseService {
  constructor(
    db: Database,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  /** Claude 토큰을 넣거나 바꾼다 */
  async saveToken(actor: Actor, req: AiTokenInput): Promise<AiLogin> {
    actor.assertOwner();
    const spaceId = AiLoginService.spaceOf(actor);
    const sealed = this.box.seal(req.token);
    const now = new Date();
    return this.transaction(async (tx) => {
      const logins = new AiLoginRepository(tx);
      const found = await logins.lock(spaceId, AiLogin.CLAUDE);
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
    const spaceId = AiLoginService.spaceOf(actor);
    const now = new Date();
    return this.transaction(async (tx) => {
      const login = await new AiLoginRepository(tx).lock(spaceId, AiLogin.CLAUDE);
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

  /** 지금 서버 키로 다시 잠근다 (pnpm secret:rotate). 바꾼 수를 돌려준다 */
  async resealSecrets(actor: Actor): Promise<number> {
    actor.assertCan(Actor.WRITE);
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

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden('owner');
    return actor.spaceId;
  }
}
