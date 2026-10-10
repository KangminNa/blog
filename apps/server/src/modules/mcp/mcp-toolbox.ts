import { Injectable } from '@nestjs/common';
import type { BaseTool } from '../platform';

// AI 도구에게 여는 MCP 도구 모음. 도구 자체(`*.tool.ts`)는 각 모듈에 있고, 그 모듈의 index.ts가 내보낸 것을 여기 모은다.
// 지금은 비어 있다 (M1 C에서 vault의 save_session이 들어온다).
@Injectable()
export class McpToolbox {
  readonly tools: readonly BaseTool[] = [];
}
