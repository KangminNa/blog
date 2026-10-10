import type { Actor } from './actor';
import type { BaseResponse } from './base-response';

// AI 도구가 부르는 MCP 도구의 기반. 도구 자체는 각 모듈(`*.tool.ts`)에 두고, mcp 모듈이 모아서 연다.
// MCP SDK는 mcp 모듈만 알고, 도구는 이름·설명·처리만 정한다.
// 처리는 Controller와 같다: Request.from(raw) → Service·Query 메서드 하나 → Response.
export abstract class BaseTool {
  /** 도구 이름 (예: save_session) */
  abstract readonly name: string;
  /** AI가 언제 이 도구를 쓸지 판단할 설명 */
  abstract readonly description: string;
  /** 필요한 권한 (Actor 상수) */
  abstract readonly scope: string;

  abstract handle(actor: Actor, raw: unknown): Promise<BaseResponse>;
}
