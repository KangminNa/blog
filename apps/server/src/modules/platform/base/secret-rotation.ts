import { Injectable } from '@nestjs/common';
import { Actor } from './actor';

// 서버 키를 바꾼 뒤 저장된 비밀값을 새 키로 다시 암호화한다 (pnpm secret:rotate).
// platform은 다른 모듈의 스키마를 모르므로, 비밀값을 가진 모듈이 onModuleInit에서 다시 잠그는 방법을 등록한다.
//
//   rotation.register('task.ai_logins', (actor) => this.logins.resealSecrets(actor));
//
// 등록하는 일은 자기 Service의 메서드 하나: 자기 트랜잭션에서 값을 잠그고 읽어 SecretBox.reseal로 바꾸고, 바꾼 수를 돌려준다.
// reseal이 이미 새 키인 값은 건너뛰므로 두 번 돌려도 안전하다. 풀리지 않는 값이 있으면 오류가 나서 그 Service의 값은 하나도 바뀌지 않는다.
// 앞의 Service는 끝나고 뒤에서 실패해도, 옛 키를 지우기 전이라면 고치고 다시 돌리면 이어서 된다.
@Injectable()
export class SecretRotation {
  private readonly holders = new Map<string, (actor: Actor) => Promise<number>>();

  register(name: string, reseal: (actor: Actor) => Promise<number>): void {
    if (this.holders.has(name)) throw new Error(`이미 등록된 비밀값이에요: ${name}`);
    this.holders.set(name, reseal);
  }

  /** 등록된 곳을 차례로 다시 잠근다. 결과는 이름별로 다시 잠근 값의 수 */
  async run(actor: Actor): Promise<ReadonlyMap<string, number>> {
    actor.assertCan(Actor.WRITE);
    const counts = new Map<string, number>();
    for (const [name, reseal] of this.holders) counts.set(name, await reseal(actor));
    return counts;
  }
}
