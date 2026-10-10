import type { Actor } from './actor';

/** 관리 동작의 결과. 관리 화면·명령줄에 그대로 보여준다 */
export class ActionResult {
  private constructor(
    readonly ok: boolean,
    readonly message: string,
    readonly details: readonly string[],
  ) {}

  static done(message: string, details: readonly string[] = []): ActionResult {
    return new ActionResult(true, message, details);
  }

  static failed(message: string, details: readonly string[] = []): ActionResult {
    return new ActionResult(false, message, details);
  }

  toJSON(): object {
    return { ok: this.ok, message: this.message, details: this.details };
  }
}

// 주인이 직접 누르는 동작 (예: 연결 확인, 지금 동기화). 관리 화면이 생기기 전에는 명령줄로 부른다.
export abstract class BaseAction {
  abstract readonly label: string;
  abstract run(actor: Actor): Promise<ActionResult>;
}
