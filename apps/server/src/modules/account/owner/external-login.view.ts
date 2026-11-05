// 외부 로그인의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 로그인 화면의 버튼 하나 */
export class LoginMethodView {
  constructor(
    readonly method: string,
    readonly label: string,
  ) {}

  toJSON() {
    return { method: this.method, label: this.label };
  }
}

/** 주인에게 연결된 외부 계정 하나 (계정 화면) */
export class LoginLinkView {
  constructor(
    readonly method: string,
    readonly label: string,
    readonly linkedAt: Date,
  ) {}

  toJSON() {
    return { method: this.method, label: this.label, linkedAt: this.linkedAt.toISOString() };
  }
}

/** 외부 로그인 시작: 그 서비스로 보낼 주소와, 이 브라우저에 줄 확인 쿠키 (응답 본문이 아니라 쿠키와 주소 이동) */
export class ExternalStartView {
  constructor(
    readonly url: string,
    readonly cookie: string,
  ) {}
}
