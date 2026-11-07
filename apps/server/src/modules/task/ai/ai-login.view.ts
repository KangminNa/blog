// AI 로그인의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 콘솔이 보는 도구 하나. 토큰은 담지 않는다 */
export class AiToolView {
  constructor(
    readonly tool: string,
    /** 토큰이 있고 만료 전인가 */
    readonly connected: boolean,
    readonly expiresAt: Date | null,
    /** 마지막 연결 확인. null이면 확인 전 */
    readonly checkedAt: Date | null,
    readonly lastError: string | null,
    /** 진행 중인 웹 로그인. 없으면 null */
    readonly signin: AiSigninView | null,
  ) {}

  toJSON() {
    return {
      tool: this.tool,
      connected: this.connected,
      expiresAt: this.expiresAt?.toISOString() ?? null,
      checkedAt: this.checkedAt?.toISOString() ?? null,
      lastError: this.lastError,
      signin: this.signin?.toJSON() ?? null,
    };
  }
}

/** GET /api/ai */
export class AiToolListView {
  constructor(readonly tools: readonly AiToolView[]) {}

  toJSON() {
    return { tools: this.tools.map((t) => t.toJSON()) };
  }
}

/** 맡긴 연결 확인. 이미 기다리는 확인이 있으면 그 작업이다 */
export class AiTestView {
  constructor(
    readonly taskId: string,
    readonly status: string,
  ) {}

  toJSON() {
    return { taskId: this.taskId, status: this.status };
  }
}

/** 러너가 받는 토큰 (ai_login). MCP 도구의 모양이라 snake_case. REST로는 나가지 않는다. Codex는 auth.json 내용, 만료 null */
export class AiTokenView {
  constructor(
    readonly token: string,
    readonly expiresAt: Date | null,
    /** 로그인의 판. 바뀐 자격을 되돌려 쓸 때(ai_login_refresh) 함께 보낸다 */
    readonly version: number,
  ) {}

  toJSON() {
    return {
      token: this.token,
      expires_at: this.expiresAt?.toISOString() ?? null,
      version: this.version,
    };
  }
}

/** ai_login_refresh의 답: 저장한 뒤의 판 */
export class AiLoginVersionView {
  constructor(readonly version: number) {}

  toJSON() {
    return { version: this.version };
  }
}

/** 진행 중인 웹 로그인 (콘솔). 주소는 주인에게만 보인다 */
export class AiSigninView {
  constructor(
    readonly taskId: string,
    /** starting · open_url · waiting_code · verifying */
    readonly step: string,
    readonly url: string | null,
    /** Codex: 주소에서 입력할 코드 */
    readonly userCode: string | null,
  ) {}

  toJSON() {
    return { taskId: this.taskId, step: this.step, url: this.url, userCode: this.userCode };
  }
}

/** 웹 로그인을 진행하는 러너에게 주는 답 (ai_signin). MCP라 snake_case */
export class AiSigninRelayView {
  constructor(
    /** 사람이 붙여 넣은 코드 (Claude). 한 번만 오고 서버에서 지운다 */
    readonly code: string | null,
    /** 주인이 취소했다: 러너는 CLI를 끄고 끝낸다 */
    readonly cancelled: boolean,
    readonly status: string,
  ) {}

  toJSON() {
    return { code: this.code, cancelled: this.cancelled, status: this.status };
  }
}
