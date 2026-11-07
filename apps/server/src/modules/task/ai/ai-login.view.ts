import type { AiLoginRow, TaskRow } from '../task.tables';

// AI 로그인의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 암호문(secret · nonce)은 받는 칸에 넣지 않는다: 화면으로 나가는 View는 그 칸을 읽을 수도 없다.

/** 진행 중인 웹 로그인 (콘솔). 주소는 주인에게만 보인다 */
export class AiSigninView {
  constructor(
    private readonly row: Readonly<Pick<TaskRow, 'id' | 'payload'>>,
    /** starting · open_url · waiting_code · verifying */
    private readonly step: string,
  ) {}

  toJSON() {
    const payload = (this.row.payload ?? {}) as Readonly<Record<string, unknown>>;
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      taskId: this.row.id,
      step: this.step,
      url: text(payload.url),
      /** Codex: 주소에서 입력할 코드 */
      userCode: text(payload.userCode),
    };
  }
}

/** 콘솔이 보는 도구 하나. 토큰은 담지 않는다 */
export class AiToolView {
  constructor(
    private readonly tool: string,
    /** 넣은 로그인. 아직 넣지 않았으면 null */
    private readonly row: Readonly<
      Pick<AiLoginRow, 'expires_at' | 'checked_at' | 'last_error'>
    > | null,
    /** 토큰이 있고 만료 전인가 */
    private readonly connected: boolean,
    /** 진행 중인 웹 로그인. 없으면 null */
    private readonly signin: AiSigninView | null = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      tool: this.tool,
      connected: this.connected,
      expiresAt: r?.expires_at?.toISOString() ?? null,
      /** 마지막 연결 확인. null이면 확인 전 */
      checkedAt: r?.checked_at?.toISOString() ?? null,
      lastError: r?.last_error ?? null,
      signin: this.signin?.toJSON() ?? null,
    };
  }
}

/** GET /api/ai */
export class AiToolListView {
  constructor(private readonly tools: readonly AiToolView[]) {}

  toJSON() {
    return { tools: this.tools.map((t) => t.toJSON()) };
  }
}

/** 맡긴 연결 확인이나 시작한 웹 로그인. 이미 기다리는 것이 있으면 그 작업이다 */
export class AiTestView {
  constructor(private readonly row: Readonly<Pick<TaskRow, 'id' | 'status'>>) {}

  toJSON() {
    return { taskId: this.row.id, status: this.row.status };
  }
}

/** 러너가 받는 토큰 (ai_login). MCP 도구의 모양이라 snake_case. REST로는 나가지 않는다. Codex는 auth.json 내용, 만료 null */
export class AiTokenView {
  constructor(
    readonly token: string,
    /** version: 로그인의 판. 바뀐 자격을 되돌려 쓸 때(ai_login_refresh) 함께 보낸다 */
    private readonly row: Readonly<Pick<AiLoginRow, 'expires_at' | 'version'>>,
  ) {}

  toJSON() {
    return {
      token: this.token,
      expires_at: this.row.expires_at?.toISOString() ?? null,
      version: this.row.version,
    };
  }
}

/** ai_login_refresh의 답: 저장한 뒤의 판 */
export class AiLoginVersionView {
  constructor(private readonly row: Readonly<Pick<AiLoginRow, 'version'>>) {}

  toJSON() {
    return { version: this.row.version };
  }
}

/** 웹 로그인을 진행하는 러너에게 주는 답 (ai_signin). MCP라 snake_case */
export class AiSigninRelayView {
  constructor(
    private readonly row: Readonly<Pick<TaskRow, 'status'>>,
    /** 주인이 취소했다: 러너는 CLI를 끄고 끝낸다 */
    private readonly cancelled: boolean,
    /** 사람이 붙여 넣은 코드 (Claude). 한 번만 오고 서버에서 지운다 */
    private readonly code: string | null,
  ) {}

  toJSON() {
    return { code: this.code, cancelled: this.cancelled, status: this.row.status };
  }
}
