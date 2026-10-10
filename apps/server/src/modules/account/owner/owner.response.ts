import { BaseResponse } from '../../platform';
import type { OwnerView } from './owner.query';

/** 로그인한 주인. 관리 화면 위쪽에 보인다 */
export class OwnerResponse extends BaseResponse {
  private constructor(private readonly login: string) {
    super();
  }

  static of(view: OwnerView): OwnerResponse {
    return new OwnerResponse(view.login);
  }

  toJSON(): object {
    return { login: this.login };
  }
}

/** 로그인됨 (쿠키는 따로 나간다) */
export class LoginResponse extends BaseResponse {
  toJSON(): object {
    return { loggedIn: true };
  }
}

/** 로그아웃 */
export class LogoutResponse extends BaseResponse {
  toJSON(): object {
    return { loggedOut: true };
  }
}

/** 비밀번호를 바꿈. 다른 기기의 로그인은 끝났다 */
export class PasswordChangedResponse extends BaseResponse {
  toJSON(): object {
    return { changed: true, otherSessionsEnded: true };
  }
}
