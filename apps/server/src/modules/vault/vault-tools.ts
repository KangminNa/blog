import { Injectable } from '@nestjs/common';
import type { BaseTool, ToolTextBody } from '../platform';
import { SubmitChangesTool } from './change/change.tool';
import { NeighborsTool } from './graph/graph.tool';
import {
  CheckSessionTool,
  GetSessionTool,
  SaveSessionTool,
  SearchSessionsTool,
} from './session/session.tool';
import { ReadTranscriptTool, SaveNoteTool, SaveTranscriptTool } from './session/transcript.tool';
import texts from './vault.tools.ko.json';
import { GetWikiTool, SearchWikisTool } from './wiki/wiki.tool';

// vault가 AI에게 여는 MCP 도구 목록. 새 도구는 여기에만 더한다 (mcp 모듈은 모듈별 목록을 모으기만 한다).
@Injectable()
export class VaultTools {
  readonly tools: readonly BaseTool[];
  /** 도구의 설명 · 칸 설명 (AI가 읽는 글). 코드가 아니라 설명서 파일이 기본이다 */
  readonly texts: Readonly<Record<string, ToolTextBody>> = texts;

  constructor(
    checkSession: CheckSessionTool,
    saveSession: SaveSessionTool,
    searchSessions: SearchSessionsTool,
    getSession: GetSessionTool,
    searchWikis: SearchWikisTool,
    getWiki: GetWikiTool,
    neighbors: NeighborsTool,
    submitChanges: SubmitChangesTool,
    saveTranscript: SaveTranscriptTool,
    readTranscript: ReadTranscriptTool,
    saveNote: SaveNoteTool,
  ) {
    this.tools = [
      checkSession,
      saveSession,
      searchSessions,
      getSession,
      searchWikis,
      getWiki,
      neighbors,
      submitChanges,
      saveTranscript,
      readTranscript,
      saveNote,
    ];
  }
}
