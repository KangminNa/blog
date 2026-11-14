// 블로그의 MCP 도구 부르기 (JSON-RPC over HTTP, 연결 명령의 news-access.mjs와 같은 모양).
//   POST <site>/mcp  Authorization: Bearer <access 토큰>  { method: 'tools/call', params: { name, arguments } }
//   성공: result.structuredContent   거절: result.isError + content[0].text의 JSON { code, message }
// 토큰이 거절되면(401) 한 번 갱신하고 다시 부른다.
import { Problem } from './problem.js';

const TIMEOUT_MS = 30_000;

/**
 * 응답 하나를 읽는다. 값을 주지 않고 무엇이 왔는지만 나눈다.
 * @returns {{ value: object } | { refused: { code: string, message: string } } | { unauthorized: true }}
 */
export function readReply(status, text) {
  if (status === 401) return { unauthorized: true };
  if (status < 200 || status >= 300) throw new Problem(`서버가 ${status}로 답했어요`);
  const body = String(text ?? '');
  // 스트림(SSE)으로 오면 마지막 data 줄이 답이다
  const json = body.trimStart().startsWith('{')
    ? body
    : (body
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .pop()
        ?.slice(5) ?? '');
  let reply;
  try {
    reply = JSON.parse(json);
  } catch {
    throw new Problem('서버의 답을 읽지 못했어요');
  }
  if (reply.error) throw new Problem(`서버가 받지 않았어요: ${reply.error.message ?? ''}`.trim());
  const result = reply.result ?? {};
  if (result.isError) {
    let refused = { code: 'error', message: String(result.content?.[0]?.text ?? '') };
    try {
      const parsed = JSON.parse(refused.message);
      if (parsed && typeof parsed === 'object')
        refused = { code: String(parsed.code ?? 'error'), message: String(parsed.message ?? '') };
    } catch {}
    return { refused };
  }
  return { value: result.structuredContent ?? {} };
}

export class Mcp {
  /**
   * @param {object} deps
   * @param {import('./connection.js').Connection} deps.connection
   * @param {typeof fetch} deps.fetch
   */
  constructor({ connection, fetch }) {
    this.connection = connection;
    this.fetch = fetch;
  }

  /** 도구 하나를 부른다. 거절이면 서버의 문구와 코드로 Problem */
  async call(name, args) {
    let key = await this.connection.key();
    let reply = await this.post(key, name, args);
    if (reply.unauthorized) {
      key = await this.connection.key(key.accessToken);
      reply = await this.post(key, name, args);
    }
    if (reply.unauthorized) throw new Problem('서버가 연결을 받지 않아요. 다시 연결해 주세요');
    if (reply.refused)
      throw new Problem(reply.refused.message || '서버가 거절했어요', reply.refused.code);
    return reply.value;
  }

  async post(key, name, args) {
    let res;
    try {
      res = await this.fetch(key.mcp, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${key.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Problem(`블로그에 닿지 않아요: ${new URL(key.mcp).origin}`);
    }
    return readReply(res.status, await res.text());
  }
}
