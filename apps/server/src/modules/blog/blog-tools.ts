import { Injectable } from '@nestjs/common';
import type { BaseTool, ToolTextBody } from '../platform';
import { BasketGetTool } from './basket/basket.tool';
import texts from './blog.tools.ko.json';
import { BlogGetPostTool, BlogSaveDraftTool } from './post/post.tool';

// blog가 AI에게 여는 MCP 도구 목록. 새 도구는 여기에만 더한다 (mcp 모듈은 모듈별 목록을 모으기만 한다).
@Injectable()
export class BlogTools {
  readonly tools: readonly BaseTool[];
  /** 도구의 설명 · 칸 설명 (AI가 읽는 글). 코드가 아니라 설명서 파일이 기본이다 */
  readonly texts: Readonly<Record<string, ToolTextBody>> = texts;

  constructor(getPost: BlogGetPostTool, saveDraft: BlogSaveDraftTool, basketGet: BasketGetTool) {
    this.tools = [getPost, saveDraft, basketGet];
  }
}
