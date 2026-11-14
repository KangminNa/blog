import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { NoteWorkInput, SaveTranscriptInput } from './session.input';
import { SessionQuery } from './session.query';
import { SessionService } from './session.service';
import type { TranscriptJobView, TranscriptSavedView } from './session.view';
import { SessionNote } from './session-note';
import { SessionTranscript } from './session-transcript';

// 세션 원문의 MCP 도구 (2차 4단계 모으기). 답은 session.view.ts의 snake_case 모양, 설명은 vault.tools.ko.json.
// save_transcript는 수집 훅 · 확장이, read_transcript · save_note는 세션 노트 일을 쥔 러너가 부른다.

// MCP 도구 save_transcript: 대화 원문을 올린다. 원문이 바뀌었을 때만 쌓고 서버 러너에게 노트를 맡긴다
@Injectable()
export class SaveTranscriptTool extends BaseTool {
  readonly name = 'save_transcript';
  readonly scope = Actor.UPLOAD;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      request_id: { type: 'string', format: 'uuid' },
      tool: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' },
      source_session_id: { type: 'string', maxLength: 200 },
      project: { type: 'string', maxLength: 100 },
      title: { type: 'string', maxLength: SessionNote.TITLE_MAX },
      started_at: { type: 'string', format: 'date-time' },
      text: { type: 'string', maxLength: SessionTranscript.MAX },
    },
    required: ['request_id', 'tool', 'source_session_id', 'text'],
  };

  constructor(private readonly sessions: SessionService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<TranscriptSavedView> {
    return (
      await this.sessions.saveTranscript(actor, SaveTranscriptInput.from(raw))
    ).transcriptView();
  }
}

/** 러너의 세션 노트 일: 쥔 일의 id */
const TASK_ID = { task_id: { type: 'string', format: 'uuid' } };

// MCP 도구 read_transcript: 세션 노트 일을 쥔 러너가 그 원문을 받는다 (AI에게 줄 만큼 줄인 글)
@Injectable()
export class ReadTranscriptTool extends BaseTool {
  readonly name = 'read_transcript';
  readonly scope = Actor.RUN;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = { properties: TASK_ID, required: ['task_id'] };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<TranscriptJobView> {
    return this.sessions.transcriptFor(actor, NoteWorkInput.from(raw));
  }
}

// MCP 도구 save_note: 세션 노트 일을 쥔 러너가 AI의 답(JSON)을 보낸다. 서버가 읽어 노트의 판으로 쌓는다
@Injectable()
export class SaveNoteTool extends BaseTool {
  readonly name = 'save_note';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: { ...TASK_ID, answer: { type: 'string', maxLength: 200_000 } },
    required: ['task_id', 'answer'],
  };

  constructor(private readonly sessions: SessionService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<TranscriptSavedView> {
    return (await this.sessions.writeNote(actor, NoteWorkInput.from(raw))).transcriptView();
  }
}
