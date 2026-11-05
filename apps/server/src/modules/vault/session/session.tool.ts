import { Injectable } from '@nestjs/common';
import { Actor, BaseResponse, BaseTool } from '../../platform';
import type { SessionReceipt } from './session';
import {
  CheckSessionInput,
  GetSessionInput,
  SaveSessionInput,
  SearchSessionsInput,
} from './session.input';
import { SessionQuery } from './session.query';
import { SessionService } from './session.service';
import type { SessionCheckView, SessionHitPageView, SessionNoteView } from './session.view';
import { SessionNote } from './session-note';

// 세션의 MCP 도구 네 개와 그 응답. AI 도구가 읽는 모양이라 snake_case다.
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 cairn-save · cairn-recall 스킬도 함께 고친다.

/** save_session 결과 (AI에게). AI가 사용자에게 보여줄 관리 화면 링크와, 서버가 지운 민감정보 경고를 함께 */
export class SaveSessionResponse extends BaseResponse {
  private constructor(
    private readonly receipt: SessionReceipt,
    private readonly site: string,
  ) {
    super();
  }

  static of(receipt: SessionReceipt, site: string): SaveSessionResponse {
    return new SaveSessionResponse(receipt, site);
  }

  toJSON(): object {
    return {
      status: this.receipt.status,
      session_id: this.receipt.sessionId,
      revision: this.receipt.seq,
      warnings: this.receipt.warnings,
      url: `${this.site}/admin/sessions?session=${this.receipt.sessionId}`,
    };
  }
}

/** check_session 결과 (AI에게). 저장할 때 그대로 쓸 값, 올릴 곳, 저장하면 서버가 지울 것 */
export class SessionCheckResponse extends BaseResponse {
  private constructor(
    private readonly view: SessionCheckView,
    private readonly site: string,
  ) {
    super();
  }

  static of(view: SessionCheckView, site: string): SessionCheckResponse {
    return new SessionCheckResponse(view, site);
  }

  toJSON(): object {
    const v = this.view;
    return {
      ok: true,
      request_id: v.requestId,
      source_session_id: v.sourceSessionId,
      existing: v.sessionId ? { session_id: v.sessionId, revisions: v.revisions } : null,
      warnings: v.redactions,
      site: this.site,
      limits: { section_max: SessionNote.SECTION_MAX, quotes_max: SessionNote.QUOTES_MAX },
    };
  }
}

/** search_sessions 결과 (AI에게). 어떤 세션을 읽을지 고를 만큼만 짧게 */
export class SessionSearchResponse extends BaseResponse {
  private constructor(private readonly page: SessionHitPageView) {
    super();
  }

  static of(page: SessionHitPageView): SessionSearchResponse {
    return new SessionSearchResponse(page);
  }

  toJSON(): object {
    return {
      sessions: this.page.hits.map((h) => ({
        session_id: h.id,
        title: h.title,
        project: h.project,
        tool: h.tool,
        date: h.lastRevisionAt,
        excerpt: h.excerpt.replace(/\s+/g, ' ').trim(),
      })),
      next: this.page.next,
    };
  }
}

/** get_session 결과 (AI에게). 칸은 save_session의 입력과 같은 이름으로, 내용이 있는 칸만 */
export class SessionNoteResponse extends BaseResponse {
  private constructor(private readonly view: SessionNoteView) {
    super();
  }

  static of(view: SessionNoteView): SessionNoteResponse {
    return new SessionNoteResponse(view);
  }

  toJSON(): object {
    const { summary, head } = this.view;
    return {
      session_id: summary.id,
      title: head.title,
      project: summary.project,
      tool: summary.tool,
      started_at: summary.startedAt,
      last_revision_at: summary.lastRevisionAt,
      revision: head.seq,
      tags: head.tags,
      // 칸은 save_session의 입력과 같은 이름으로, 내용이 있는 칸만 (칸 순서 그대로)
      sections: Object.fromEntries(
        head.sections.filter((s) => s.text).map((s) => [s.name, s.text]),
      ),
    };
  }
}

// MCP 도구 save_session: AI 도구가 작업한 세션의 노트를 저장한다. mcp 모듈이 모아서 연다.
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 cairn-save 스킬도 함께 고친다.
@Injectable()
export class SaveSessionTool extends BaseTool {
  readonly name = 'save_session';
  readonly scope = Actor.UPLOAD;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly description = [
    '방금 함께 작업한 AI 세션의 노트를 Cairn 블로그에 저장한다.',
    '먼저 check_session으로 검사하고, 받은 request_id와 source_session_id를 그대로 쓴다. 사용자에게 노트와 올릴 곳을 보여 주고 확인받은 뒤에 부른다.',
    '같은 대화(source_session_id)를 다시 저장하면 같은 세션에 새 판으로 쌓인다. 내용이 같으면 판을 만들지 않는다(unchanged).',
    '토큰·키·비밀번호는 보내기 전에 지운다. 서버도 한 번 더 지우고 warnings로 알려 준다.',
    '공개 여부는 정할 수 없다 (늘 비공개로 저장된다). 응답의 url을 사용자에게 보여 준다.',
  ].join(' ');
  /** 노트 모양. 저장(save_session)과 검사(check_session)가 같이 쓴다 */
  static readonly NOTE_PROPERTIES: Readonly<Record<string, unknown>> = {
    source_session_id: {
      type: 'string',
      maxLength: 200,
      description: 'AI 도구 안의 대화 id. 같은 대화는 늘 같은 값',
    },
    tool: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9-]{0,39}$',
      description: 'AI 도구 이름 (예: claude-code, codex)',
    },
    project: { type: 'string', maxLength: 100, description: '작업한 프로젝트 (예: 저장소 이름)' },
    title: { type: 'string', maxLength: 200, description: '세션 제목. 한 일을 한 줄로' },
    did: { type: 'string', maxLength: SessionNote.SECTION_MAX, description: '한 일' },
    decisions: {
      type: 'string',
      maxLength: SessionNote.SECTION_MAX,
      description: '결정한 것과 이유',
    },
    blocked: {
      type: 'string',
      maxLength: SessionNote.SECTION_MAX,
      description: '막힌 점, 남은 문제',
    },
    quotes: {
      type: 'string',
      maxLength: SessionNote.QUOTES_MAX,
      description: `핵심 원문 인용 (${SessionNote.QUOTES_MAX.toLocaleString('en-US')}자까지)`,
    },
    extra: { type: 'string', maxLength: SessionNote.SECTION_MAX, description: '기타' },
    tags: {
      type: 'array',
      items: { type: 'string', maxLength: 40 },
      maxItems: 20,
      description: '태그',
    },
    started_at: {
      type: 'string',
      format: 'date-time',
      description: '세션을 시작한 시각 (ISO 8601)',
    },
  };

  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        format: 'uuid',
        description: 'check_session이 준 UUID. 응답을 받지 못해 다시 보낼 때는 같은 값을 쓴다',
      },
      ...SaveSessionTool.NOTE_PROPERTIES,
    },
    required: ['request_id', 'source_session_id', 'tool', 'title'],
  };

  constructor(private readonly sessions: SessionService) {
    super();
  }

  async handle(actor: Actor, raw: unknown, site: string): Promise<SaveSessionResponse> {
    return SaveSessionResponse.of(
      await this.sessions.save(actor, SaveSessionInput.from(raw)),
      site,
    );
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
  readonly description = [
    '세션 노트를 저장하기 전에 검사한다. 저장하지 않는다.',
    '노트 모양이 틀리면 고칠 칸을 알려 주고, 저장하면 서버가 지울 비밀값을 warnings로 알려 준다.',
    '이번 저장에 쓸 request_id와 대화 id(source_session_id)를 준다. 대화 id를 모르면 비워 두고, 받은 값을 이 대화의 다음 저장에도 쓴다.',
    'site는 노트가 올라갈 블로그 주소다. 사용자에게 보여 주고 확인받은 뒤 save_session으로 저장한다.',
  ].join(' ');
  readonly inputSchema = {
    properties: SaveSessionTool.NOTE_PROPERTIES,
    required: ['title'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  async handle(actor: Actor, raw: unknown, site: string): Promise<SessionCheckResponse> {
    return SessionCheckResponse.of(
      await this.sessions.check(actor, CheckSessionInput.from(raw)),
      site,
    );
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
  readonly description = [
    '저장된 세션 노트를 키워드로 찾는다. 제목과 본문에서 찾고, 한국어도 된다.',
    '띄어 쓴 단어가 모두 들어 있는 세션만 찾는다. 대소문자를 구분하니 없으면 표기를 바꿔 다시 찾는다.',
    'project, tool, from, to로 좁힐 수 있다. from과 to는 마지막 저장 시각 기준이다.',
    '결과는 처음 저장한 때가 최근인 세션부터 나온다. next가 있으면 cursor에 그대로 넣어 다음 쪽을 부른다.',
    '이 연결이 볼 수 있는 세션만 나온다. 내용 전체는 session_id로 get_session을 불러 읽는다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      query: {
        type: 'string',
        maxLength: SearchSessionsInput.QUERY_MAX,
        description: '찾을 말. 에러 메시지나 코드 이름처럼 본문에 그대로 있을 말이 잘 찾아진다',
      },
      project: { type: 'string', maxLength: 100, description: '이 프로젝트의 세션만' },
      tool: { type: 'string', maxLength: 40, description: '이 AI 도구의 세션만 (예: claude-code)' },
      from: {
        type: 'string',
        format: 'date-time',
        description: '이 시각부터 저장된 세션만 (ISO 8601)',
      },
      to: {
        type: 'string',
        format: 'date-time',
        description: '이 시각까지 저장된 세션만 (ISO 8601)',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: SearchSessionsInput.LIMIT_MAX,
        default: SearchSessionsInput.LIMIT_DEFAULT,
        description: '한 쪽에 받을 세션 수',
      },
      cursor: { type: 'string', maxLength: 100, description: '앞 응답의 next 값 그대로' },
    },
    required: ['query'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<SessionSearchResponse> {
    return SessionSearchResponse.of(
      await this.sessions.search(actor, SearchSessionsInput.from(raw)),
    );
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
  readonly description = [
    '저장된 세션 노트 하나의 지금 판을 읽는다.',
    '제목, 프로젝트, 도구, 시작·마지막 저장 시각, 판 번호, 태그와 내용이 있는 칸을 준다.',
    '칸 이름은 save_session의 입력과 같다 (did, decisions, blocked, quotes, extra).',
    '[지움: 종류]는 저장할 때 지운 비밀값 자리다. session_id는 search_sessions의 결과에서 얻는다.',
    '없거나 이 연결이 볼 수 없는 세션이면 not_found가 온다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      session_id: { type: 'string', format: 'uuid', description: '읽을 세션의 id' },
    },
    required: ['session_id'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<SessionNoteResponse> {
    return SessionNoteResponse.of(await this.sessions.note(actor, GetSessionInput.from(raw)));
  }
}
