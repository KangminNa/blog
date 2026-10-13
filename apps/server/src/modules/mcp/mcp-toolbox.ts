import { Injectable } from '@nestjs/common';
import type { BaseTool } from '../platform';
import { SaveSessionTool } from '../vault';

// AI 도구에게 여는 MCP 도구 모음. 도구 자체(`*.tool.ts`)는 각 모듈에 있고, 그 모듈의 index.ts가 내보낸 것을 여기 모은다.
// 새 도구는 그 모듈의 index.ts에서 내보내고 여기 생성자에 하나 더한다.
@Injectable()
export class McpToolbox {
  readonly tools: readonly BaseTool[];

  constructor(saveSession: SaveSessionTool) {
    this.tools = [saveSession];
  }
}
