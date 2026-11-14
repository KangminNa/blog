import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import {
  CheckSessionInput,
  GetSessionInput,
  SaveSessionInput,
  SearchSessionsInput,
} from './session.input';
import { SessionQuery } from './session.query';
import { SessionService } from './session.service';
import type {
  SessionCheckView,
  SessionHitPageView,
  SessionNoteView,
  SessionSavedView,
} from './session.view';
import { SessionNote } from './session-note';

// 세션의 MCP 도구 네 개. 답은 session.view.ts의 AI용 모양(snake_case)이다.
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 cairn-save · cairn-recall 스킬도 함께 고친다.

// MCP 도구 save_session: AI 도구가 작업한 세션의 노트를 저장한다. mcp 모듈이 모아서 연다.
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 cairn-save 스킬도 함께 고친다.
@Injectable()
export class SaveSessionTool extends BaseTool {
  readonly name = 'save_session';
  readonly scope = Actor.UPLOAD;
  readonly readOnly = false;
  override readonly idempotent = true;
  /** 노트 모양. 저장(save_session)과 검사(check_session)가 같이 쓴다 */
  static readonly NOTE_PROPERTIES: Readonly<Record<string, unknown>> = {
    source_session_id: {
      type: 'string',
      maxLength: 200,
    },
    tool: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9-]{0,39}$',
    },
    project: { type: 'string', maxLength: 100 },
    title: { type: 'string', maxLength: 200 },
    did: { type: 'string', maxLength: SessionNote.SECTION_MAX },
    decisions: {
      type: 'string',
      maxLength: SessionNote.SECTION_MAX,
    },
    blocked: {
      type: 'string',
      maxLength: SessionNote.SECTION_MAX,
    },
    quotes: {
      type: 'string',
      maxLength: SessionNote.QUOTES_MAX,
    },
    extra: { type: 'string', maxLength: SessionNote.SECTION_MAX },
    tags: {
      type: 'array',
      items: { type: 'string', maxLength: 40 },
      maxItems: 20,
    },
    started_at: {
      type: 'string',
      format: 'date-time',
    },
  };

  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        format: 'uuid',
      },
      ...SaveSessionTool.NOTE_PROPERTIES,
    },
    required: ['request_id', 'source_session_id', 'tool', 'title'],
  };

  constructor(private readonly sessions: SessionService) {
    super();
  }

  async handle(actor: Actor, raw: unknown, site: string): Promise<SessionSavedView> {
    return (await this.sessions.save(actor, SaveSessionInput.from(raw))).view(site);
  }
}

// MCP 도구 check_session: 저장하기 전에 세션 노트를 검사한다 (아무것도 쓰지 않는다).
// 대화 원문이나 스크립트를 쓸 수 없는 도구(ChatGPT·Claude 앱)도 이것으로 기계 검사를 하고, 저장에 쓸 id를 받는다.
@Injectable()
export class CheckSessionTool extends BaseTool {
  readonly name = 'check_session';
  readonly scope = Actor.UPLOAD;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: SaveSessionTool.NOTE_PROPERTIES,
    required: ['title'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown, site: string): Promise<SessionCheckView> {
    return this.sessions.check(actor, CheckSessionInput.from(raw), site);
  }
}

// MCP 도구 search_sessions: 저장된 세션 노트를 키워드로 찾는다. 요청자가 볼 수 있는 세션만 나온다.
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 이 도구를 쓰는 스킬도 함께 고친다.
@Injectable()
export class SearchSessionsTool extends BaseTool {
  readonly name = 'search_sessions';
  readonly scope = Actor.READ_PUBLIC;
  override readonly orScope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      query: {
        type: 'string',
        maxLength: SearchSessionsInput.QUERY_MAX,
      },
      project: { type: 'string', maxLength: 100 },
      tool: { type: 'string', maxLength: 40 },
      from: {
        type: 'string',
        format: 'date-time',
      },
      to: {
        type: 'string',
        format: 'date-time',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: SearchSessionsInput.LIMIT_MAX,
        default: SearchSessionsInput.LIMIT_DEFAULT,
      },
      cursor: { type: 'string', maxLength: 100 },
    },
    required: ['query'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<SessionHitPageView> {
    return this.sessions.search(actor, SearchSessionsInput.from(raw));
  }
}

// MCP 도구 get_session: 세션 하나의 지금 판을 읽는다. 볼 수 없는 세션은 없는 세션과 똑같이 답한다.
@Injectable()
export class GetSessionTool extends BaseTool {
  readonly name = 'get_session';
  readonly scope = Actor.READ_PUBLIC;
  override readonly orScope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      session_id: { type: 'string', format: 'uuid' },
    },
    required: ['session_id'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<SessionNoteView> {
    return this.sessions.note(actor, GetSessionInput.from(raw));
  }
}
