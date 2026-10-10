import { BaseRequest, type RequestFields } from '../../platform';

/** 설치 때 주인 계정 만들기: { "login": "kangmin", "password": "…" } */
export class CreateOwnerRequest extends BaseRequest {
  private constructor(
    readonly login: string,
    readonly password: string,
  ) {
    super();
  }

  /** 아이디: 영문 소문자·숫자·-·_ 3~40자. 대문자로 넣어도 소문자로 받는다 */
  private static readLogin(f: RequestFields): string {
    const login = f.text('login', 40).trim().toLowerCase();
    if (login && !/^[a-z0-9_-]{3,40}$/.test(login))
      f.reject('login', '영문 소문자·숫자·-·_로 3~40자여야 해요');
    return login;
  }

  static from(raw: unknown): CreateOwnerRequest {
    return BaseRequest.read(
      raw,
      (f) => new CreateOwnerRequest(CreateOwnerRequest.readLogin(f), f.text('password', 200)),
    );
  }
}

/** 로그인 */
export class LoginRequest extends BaseRequest {
  private constructor(
    readonly login: string,
    readonly password: string,
  ) {
    super();
  }

  static from(raw: unknown): LoginRequest {
    return BaseRequest.read(
      raw,
      (f) => new LoginRequest(f.text('login', 40).trim().toLowerCase(), f.text('password', 200)),
    );
  }
}

/** 비밀번호 바꾸기: 지금 비밀번호를 한 번 더 확인한다 */
export class ChangePasswordRequest extends BaseRequest {
  private constructor(
    readonly current: string,
    readonly next: string,
  ) {
    super();
  }

  static from(raw: unknown): ChangePasswordRequest {
    return BaseRequest.read(
      raw,
      (f) => new ChangePasswordRequest(f.text('current', 200), f.text('next', 200)),
    );
  }
}
