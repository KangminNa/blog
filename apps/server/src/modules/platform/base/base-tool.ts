import type { Actor } from './actor';

// AI 도구가 부르는 MCP 도구의 기반. 도구 자체는 각 모듈(`*.tool.ts`)에 두고, mcp 모듈이 모아서 연다.
// MCP SDK는 platform/base의 McpEndpoint만 알고, 도구는 이름·설명·입력 모양·처리만 정한다.
// 처리는 Controller와 같다: Input.from(raw) → Service·Query 메서드 하나 → View.
// site는 블로그의 사이트 주소(예: https://blog.example.com). 응답에 관리 화면 링크를 넣을 때 쓴다.
// 사이트 주소는 account 모듈이 가지고 있어서, 도구가 있는 모듈 대신 MCP 입구(mcp 모듈)가 읽어 넘긴다.
/** 도구의 답. View처럼 toJSON으로 내보낼 모양을 정한다 (MCP는 snake_case) */
export interface ToolAnswer {
  toJSON(): object;
}

export abstract class BaseTool {
  /** 도구 이름 (예: save_session) */
  abstract readonly name: string;
  /** AI가 언제 이 도구를 쓸지 판단할 설명 */
  abstract readonly description: string;
  /** 필요한 권한 (Actor 상수). 이 권한이 없는 기기에게는 목록에도 보이지 않는다 */
  abstract readonly scope: string;
  /** scope 대신 이 도구를 열어 주는 권한. 둘 중 하나만 있으면 된다 (예: 공개 읽기 또는 전체 읽기) */
  readonly orScope: string | null = null;
  /** 입력 모양 (JSON Schema). AI가 보고 인자를 만든다. 검사는 Request가 한다 */
  abstract readonly inputSchema: Readonly<Record<string, unknown>>;
  /**
   * 읽기만 하는가. AI 앱이 부르기 전에 사용자에게 확인을 물을지 이것을 보고 정한다
   * (MCP annotations의 readOnlyHint. Claude 앱 커넥터는 모든 도구에 이 표시를 요구한다)
   */
  abstract readonly readOnly: boolean;
  /** 이미 있는 것을 지우거나 덮어쓰는가 (destructiveHint). Cairn의 도구는 추가만 해서 기본은 false */
  readonly destructive: boolean = false;
  /** 같은 입력을 다시 보내도 결과가 같은가 (idempotentHint) */
  readonly idempotent: boolean = false;

  /** 이 요청자가 쓸 수 있는 도구인가. 권한은 actor.can으로만 묻는다 (Actor 종류를 보지 않는다) */
  allows(actor: Actor): boolean {
    return actor.can(this.scope) || (this.orScope !== null && actor.can(this.orScope));
  }

  abstract handle(actor: Actor, raw: unknown, site: string): Promise<ToolAnswer>;
}
