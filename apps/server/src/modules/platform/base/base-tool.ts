import type { Actor } from './actor';
import type { BaseResponse } from './base-response';

// AI 도구가 부르는 MCP 도구의 기반. 도구 자체는 각 모듈(`*.tool.ts`)에 두고, mcp 모듈이 모아서 연다.
// MCP SDK는 platform/base의 McpEndpoint만 알고, 도구는 이름·설명·입력 모양·처리만 정한다.
// 처리는 Controller와 같다: Request.from(raw) → Service·Query 메서드 하나 → Response.
export abstract class BaseTool {
  /** 도구 이름 (예: save_session) */
  abstract readonly name: string;
  /** AI가 언제 이 도구를 쓸지 판단할 설명 */
  abstract readonly description: string;
  /** 필요한 권한 (Actor 상수). 이 권한이 없는 기기에게는 목록에도 보이지 않는다 */
  abstract readonly scope: string;
  /** 입력 모양 (JSON Schema). AI가 보고 인자를 만든다. 검사는 Request가 한다 */
  abstract readonly inputSchema: Readonly<Record<string, unknown>>;

  abstract handle(actor: Actor, raw: unknown): Promise<BaseResponse>;
}
