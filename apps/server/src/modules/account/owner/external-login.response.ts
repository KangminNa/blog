import { BaseResponse } from '../../platform';
import type { LoginLinkView, LoginMethodView } from './external-login.query';

/** 로그인 화면의 버튼들 (켜진 로그인 플러그인) */
export class LoginMethodsResponse extends BaseResponse {
  private constructor(private readonly methods: readonly LoginMethodView[]) {
    super();
  }

  static of(methods: readonly LoginMethodView[]): LoginMethodsResponse {
    return new LoginMethodsResponse(methods);
  }

  toJSON(): object {
    return { methods: this.methods.map((m) => ({ method: m.method, label: m.label })) };
  }
}

/** 주인에게 연결된 외부 계정들 (계정 시트) */
export class LoginLinksResponse extends BaseResponse {
  private constructor(private readonly links: readonly LoginLinkView[]) {
    super();
  }

  static of(links: readonly LoginLinkView[]): LoginLinksResponse {
    return new LoginLinksResponse(links);
  }

  toJSON(): object {
    return {
      links: this.links.map((l) => ({
        method: l.method,
        label: l.label,
        linkedAt: l.linkedAt.toISOString(),
      })),
    };
  }
}

/** 연결을 끊음 */
export class UnlinkedResponse extends BaseResponse {
  toJSON(): object {
    return { unlinked: true };
  }
}
