import { Injectable } from '@nestjs/common';
import type { BaseTool } from '../platform';
import { CheckSessionTool } from './session/check-session.tool';
import { SaveSessionTool } from './session/save-session.tool';

// vault가 AI에게 여는 MCP 도구 목록. 새 도구는 여기에만 더한다 (mcp 모듈은 모듈별 목록을 모으기만 한다).
@Injectable()
export class VaultTools {
  readonly tools: readonly BaseTool[];

  constructor(checkSession: CheckSessionTool, saveSession: SaveSessionTool) {
    this.tools = [checkSession, saveSession];
  }
}
