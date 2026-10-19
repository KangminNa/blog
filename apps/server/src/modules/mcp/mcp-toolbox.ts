import { Injectable } from '@nestjs/common';
import type { BaseTool } from '../platform';
import { CheckSessionTool, SaveSessionTool } from '../vault';

// AI 도구에게 여는 MCP 도구 모음. 도구 자체(`*.tool.ts`)는 각 모듈에 있고, 그 모듈의 index.ts가 내보낸 것을 여기 모은다.
// 새 도구는 그 모듈의 index.ts에서 내보내고 여기 생성자에 하나 더한다.
@Injectable()
export class McpToolbox {
  /**
   * AI 도구가 붙을 때 받는 안내 (MCP instructions). 스킬이 없는 도구도 이것만 보고 저장할 수 있게,
   * 앞 512자 안에 순서가 다 들어가게 쓴다 (Codex는 앞부분만 읽는다). 순서를 바꾸면 skills/cairn-save도 함께 고친다.
   */
  static readonly INSTRUCTIONS = [
    'Cairn 블로그의 MCP 서버. 사용자가 이 대화(세션)를 저장해 달라고 하면:',
    '1) 이 대화에서 실제로 일어난 일만 세션 노트로 쓴다: 한 일(확인된 결과와 함께), 결정(이유·고르지 않은 대안·누가 정했나), 막힌 점(확인 못 한 것 포함), 원문 그대로의 핵심 인용. 지어내지 않고, 비밀값은 [지움: 종류]로 바꾼다.',
    '2) check_session으로 검사하고 받은 request_id·source_session_id를 쓴다.',
    '3) 노트와 올릴 곳(site)을 사용자에게 보여 주고 확인받는다.',
    '4) save_session으로 저장하고 url을 알린다.',
    '같은 대화를 다시 저장할 때는 같은 source_session_id를 쓴다. cairn-save 스킬이 있으면 그 순서와 규칙을 따른다.',
  ].join('\n');

  readonly tools: readonly BaseTool[];

  constructor(saveSession: SaveSessionTool, checkSession: CheckSessionTool) {
    this.tools = [checkSession, saveSession];
  }
}
