import { Json } from './json';

/** 서버에 닿지 못했거나 서버가 잠시 답하지 못함. 같은 요청을 다시 보내도 된다 */
export class ServerUnreachable extends Error {}

/** 토큰이 맞지 않음. 다시 보내도 소용없다 */
export class AccessDenied extends Error {}

/** 서버가 도구 호출을 거절함 (규칙 위반, 권한 없음). 다시 보내도 소용없다 */
export class ToolRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// MCP 도구 부르기 (JSON-RPC over HTTP). 서버는 요청마다 새로 만드는 상태 없는 방식이라
// initialize로 세션을 열지 않아도 tools/call을 받는다 (platform/base/mcp-endpoint.ts).
// SDK를 쓰지 않는 이유: 러너가 쓰는 건 tools/call 하나뿐이다.
export class McpClient {
  /** 서버가 일을 끝내고 답하기까지 기다리는 시간 */
  private static readonly PATIENCE_MS = 15_000;
  /** 서버의 DB가 잠시 밀림 (잠금 대기 · 긴 쿼리). 거절이 아니라 같은 요청을 다시 보내면 된다 */
  private static readonly BUSY = 'busy';
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  /**
   * 도구 하나를 부르고 결과를 돌려준다.
   * waitMs: 서버가 일부러 기다리는 시간(긴 폴링). stop: 러너가 멈출 때 끊는다.
   */
  async call(tool: string, args: object, waitMs = 0, stop?: AbortSignal): Promise<Json> {
    const res = await this.post(tool, args, waitMs, stop);
    if (res.status === 401 || res.status === 403)
      throw new AccessDenied('기기 토큰이 맞지 않아요. 관리 화면 → 기기에서 확인해 주세요');
    if (!res.ok) throw new ServerUnreachable(await McpClient.failureOf(res));
    const body = Json.parse(await this.read(res));
    if (body === null) throw new ServerUnreachable('서버의 답을 읽지 못했어요');
    const failure = body.child('error');
    if (failure.optionalText('message') !== null)
      throw new ServerUnreachable(`서버 오류: ${failure.text('message')}`);
    const result = body.child('result');
    if (result.flag('isError')) throw McpClient.refusal(result);
    return result.child('structuredContent');
  }

  private async post(
    tool: string,
    args: object,
    waitMs: number,
    stop: AbortSignal | undefined,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(waitMs + McpClient.PATIENCE_MS);
    try {
      return await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        }),
        signal: stop ? AbortSignal.any([stop, timeout]) : timeout,
      });
    } catch (error) {
      throw new ServerUnreachable(`서버에 닿지 못했어요: ${(error as Error).message}`);
    }
  }

  private async read(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch (error) {
      throw new ServerUnreachable(`답을 받다가 끊겼어요: ${(error as Error).message}`);
    }
  }

  /** 서버가 이유를 적어 보냈으면 함께 보여 준다 (예: 사이트 주소를 아직 정하지 않음). 고치면 러너는 그대로 이어 간다 */
  private static async failureOf(res: Response): Promise<string> {
    const body = await res.text().catch(() => '');
    const reason = Json.parse(body)?.optionalText('message');
    return reason
      ? `서버가 ${res.status}로 답했어요: ${reason}`
      : `서버가 ${res.status}로 답했어요`;
  }

  /**
   * 도구 오류는 첫 글의 JSON에 담겨 온다 (DomainError.toJSON). busy만 다시 보낼 수 있는 실패다:
   * 거절로 받으면 일하던 러너가 그 일을 놓아 버린다 (JobRun.endingOfFailure)
   */
  private static refusal(result: Json): ToolRefused | ServerUnreachable {
    const detail = Json.parse(result.list('content')[0]?.text('text') ?? '') ?? Json.of({});
    const code = detail.text('code') || 'unknown';
    const message = detail.text('message') || '서버가 거절했어요';
    if (code === McpClient.BUSY) return new ServerUnreachable(`서버가 바빠요: ${message}`);
    return new ToolRefused(code, message);
  }
}
