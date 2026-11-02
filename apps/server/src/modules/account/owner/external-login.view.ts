import type { LoginLinkRow } from '../account.tables';

// 외부 로그인의 읽기 모양. 외부 서비스의 계정 id(subject)는 내보내지 않는다.

/** 로그인 화면의 버튼 하나 */
export class LoginMethodView {
  constructor(
    private readonly method: string,
    private readonly label: string,
  ) {}

  toJSON() {
    return { method: this.method, label: this.label };
  }
}

/** 로그인 화면의 버튼들 (켜진 로그인 플러그인) */
export class LoginMethodsView {
  constructor(private readonly methods: readonly LoginMethodView[]) {}

  toJSON() {
    return { methods: this.methods.map((m) => m.toJSON()) };
  }
}

/** 주인에게 연결된 외부 계정 하나 (계정 화면) */
export class LoginLinkView {
  constructor(
    private readonly row: Readonly<Pick<LoginLinkRow, 'method' | 'label' | 'created_at'>>,
  ) {}

  toJSON() {
    const r = this.row;
    return { method: r.method, label: r.label ?? '', linkedAt: r.created_at.toISOString() };
  }
}

/** 주인에게 연결된 외부 계정들 (계정 화면) */
export class LoginLinksView {
  constructor(private readonly links: readonly LoginLinkView[]) {}

  toJSON() {
    return { links: this.links.map((l) => l.toJSON()) };
  }
}

/** 외부 로그인 시작: 그 서비스로 보낼 주소와, 이 브라우저에 줄 확인 쿠키. 응답 본문으로 나가지 않는다 */
export class ExternalStartView {
  constructor(
    readonly url: string,
    readonly cookie: string,
  ) {}
}
