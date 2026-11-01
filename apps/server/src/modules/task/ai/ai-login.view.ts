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
  ) {}

  toJSON() {
    return {
      tool: this.tool,
      connected: this.connected,
      expiresAt: this.expiresAt?.toISOString() ?? null,
      checkedAt: this.checkedAt?.toISOString() ?? null,
      lastError: this.lastError,
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

/** 러너가 받는 토큰 (ai_login). MCP 도구의 모양이라 snake_case. REST로는 나가지 않는다 */
export class AiTokenView {
  constructor(
    readonly token: string,
    readonly expiresAt: Date,
  ) {}

  toJSON() {
    return { token: this.token, expires_at: this.expiresAt.toISOString() };
  }
}
