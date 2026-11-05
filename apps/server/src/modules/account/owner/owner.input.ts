import { BaseRequest, type RequestFields } from '../../platform';

/** 설치 때 주인 계정 만들기: { "login": "kangmin", "password": "…" } */
export class CreateOwnerInput extends BaseRequest {
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

  static from(raw: unknown): CreateOwnerInput {
    return BaseRequest.read(
      raw,
      (f) => new CreateOwnerInput(CreateOwnerInput.readLogin(f), f.text('password', 200)),
    );
  }
}

/** 로그인 */
export class LoginInput extends BaseRequest {
  private constructor(
    readonly login: string,
    readonly password: string,
  ) {
    super();
  }

  static from(raw: unknown): LoginInput {
    return BaseRequest.read(
      raw,
      (f) => new LoginInput(f.text('login', 40).trim().toLowerCase(), f.text('password', 200)),
    );
  }
}

/** 비밀번호 바꾸기: 지금 비밀번호를 한 번 더 확인한다 */
export class ChangePasswordInput extends BaseRequest {
  private constructor(
    readonly current: string,
    readonly next: string,
  ) {
    super();
  }

  static from(raw: unknown): ChangePasswordInput {
    return BaseRequest.read(
      raw,
      (f) => new ChangePasswordInput(f.text('current', 200), f.text('next', 200)),
    );
  }
}
