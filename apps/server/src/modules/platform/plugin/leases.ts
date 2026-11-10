import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';

/** 러너가 지금 임대를 쥔 일 하나: id · 종류 · 입력. 기능 패키지가 러너의 도구 호출을 그 일에 묶을 때 쓴다 */
export class LeasedWork {
  constructor(
    readonly id: string,
    readonly kind: string,
    readonly payload: unknown,
  ) {}
}

// 임대 확인 (기능 패키지 API 0.3): 패키지는 코어의 표를 읽지 못하므로, 러너가 부른 도구가
// "이 러너가 지금 그 일을 쥐고 있는가"를 물을 길을 둔다. 일을 빌려 주는 모듈이 시작할 때 확인하는 길을 등록하고,
// 패키지는 work.leased(id)로 묻는다. platform은 누가 등록하는지 모른다 (SecretRotation · BlobStore.registerUse와 같은 방식).
@Injectable()
export class Leases {
  private check: ((actor: Actor, id: string) => Promise<LeasedWork>) | null = null;

  /** 일을 빌려 주는 모듈이 한 번 등록한다. 쥐고 있지 않으면 check가 던진다 (RuleViolation · NotFound) */
  register(check: (actor: Actor, id: string) => Promise<LeasedWork>): void {
    if (this.check) throw new Error('임대 확인은 한 곳만 등록해요');
    this.check = check;
  }

  /** 이 요청자가 지금 쥔 일. 확인할 모듈이 없으면 오류 (서버 구성이 틀렸다) */
  of(actor: Actor, id: string): Promise<LeasedWork> {
    if (!this.check) throw new Error('임대를 확인할 모듈이 등록되지 않았어요');
    return this.check(actor, id);
  }
}
