import type { LoginLinkRow } from '../account.tables';

// 외부 로그인의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 연결한 계정의 subject(그 서비스의 계정 번호)는 내보내지 않는다.

/** 로그인 화면의 버튼 하나 (켜진 로그인 플러그인) */
export class LoginMethodView {
  constructor(
    private readonly method: string,
    private readonly label: string,
  ) {}

  toJSON() {
    return { method: this.method, label: this.label };
  }
}

/** 로그인 화면의 버튼들 */
export class LoginMethodListView {
  constructor(private readonly methods: readonly LoginMethodView[]) {}

  toJSON() {
    return { methods: this.methods.map((m) => m.toJSON()) };
  }
}

/** 주인에게 연결된 외부 계정 하나 (계정 화면) */
export class LoginLinkView {
  constructor(private readonly row: Readonly<LoginLinkRow>) {}

  toJSON() {
    const r = this.row;
    return { method: r.method, label: r.label ?? '', linkedAt: r.created_at.toISOString() };
  }
}

/** 주인에게 연결된 외부 계정들 */
export class LoginLinkListView {
  constructor(private readonly links: readonly LoginLinkView[]) {}

  toJSON() {
    return { links: this.links.map((l) => l.toJSON()) };
  }
}

/** 연결을 끊음 */
export class UnlinkedView {
  toJSON() {
    return { unlinked: true };
  }
}

/** 외부 로그인 시작: 그 서비스로 보낼 주소와, 이 브라우저에 줄 확인 쿠키 (응답 본문이 아니라 쿠키와 주소 이동) */
export class ExternalStartView {
  constructor(
    readonly url: string,
    readonly cookie: string,
  ) {}
}
