import { Injectable } from '@nestjs/common';
import type { BaseTool } from '../platform';
import { BasketGetTool } from './basket/basket.tool';
import { BlogGetPostTool, BlogSaveDraftTool } from './post/post.tool';

// blog가 AI에게 여는 MCP 도구 목록. 새 도구는 여기에만 더한다 (mcp 모듈은 모듈별 목록을 모으기만 한다).
@Injectable()
export class BlogTools {
  readonly tools: readonly BaseTool[];

  constructor(getPost: BlogGetPostTool, saveDraft: BlogSaveDraftTool, basketGet: BasketGetTool) {
    this.tools = [getPost, saveDraft, basketGet];
  }
}
