import type { AiLoginRow, TaskRow } from '../task.tables';

// AI 로그인의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 암호문 칸(secret, nonce)은 어느 View에도 받지 않는다.

/** 콘솔이 보는 도구 하나. 토큰은 담지 않는다 */
export class AiToolView {
  constructor(
    private readonly tool: string,
    /** 토큰이 있고 만료 전인가 */
    private readonly connected: boolean,
    /** 넣어 둔 로그인. 아직 없으면 null. checked_at이 null이면 확인 전 */
    private readonly row: Pick<AiLoginRow, 'expires_at' | 'checked_at' | 'last_error'> | null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      tool: this.tool,
      connected: this.connected,
      expiresAt: r?.expires_at.toISOString() ?? null,
      checkedAt: r?.checked_at?.toISOString() ?? null,
      lastError: r?.last_error ?? null,
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

/** 맡긴 연결 확인. 이미 기다리는 확인이 있으면 그 작업이다 */
export class AiTestView {
  constructor(private readonly row: Pick<TaskRow, 'id' | 'status'>) {}

  toJSON() {
    return { taskId: this.row.id, status: this.row.status };
  }
}

/** 러너가 받는 토큰 (ai_login). MCP 도구의 모양이라 snake_case. REST로는 나가지 않는다 */
export class AiTokenView {
  constructor(
    readonly token: string,
    private readonly row: Pick<AiLoginRow, 'expires_at'>,
  ) {}

  toJSON() {
    return { token: this.token, expires_at: this.row.expires_at.toISOString() };
  }
}
