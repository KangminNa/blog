import type { CairnServer } from './cairn-server';
import type { Job } from './job';
import { RunEnding } from './job-run';
import { ServerUnreachable, ToolRefused } from './mcp-client';
import type { NoteSource } from './note-source';
import { RunEvent, RunResult } from './progress';
import type { PromptPack } from './prompt-pack';
import type { Redactor } from './redactor';
import type { SandboxStage } from './sandbox-stage';

type Note = (event: RunEvent) => void;

// 세션 노트 일(session_note, 2차 4단계)의 앞뒤. 에이전트 · 작업 토큰 · MCP 없이 지시문 틀 하나를 돌린다 (배정 일처럼).
//   앞: 쥔 일의 원문을 vault에서 받는다 (read_transcript). 원문은 작업에 실려 오지 않는다 (비공개 사본을 vault 밖에 두지 않게)
//   뒤: AI의 답(JSON)을 그대로 vault에 보낸다 (save_note). 서버가 노트로 읽어 판을 쌓는다. 읽지 못하면 일을 실패로 끝낸다
export class NoteStage implements SandboxStage {
  readonly workspaceRoom = null;
  readonly needsOutputs = false;
  readonly awaitsApproval = false;
  unreachable = false;
  private source: NoteSource | null = null;

  constructor(
    private readonly job: Job,
    private readonly server: CairnServer,
  ) {}

  async prepare(signal: AbortSignal, note: Note, redactor: Redactor): Promise<RunEnding | null> {
    try {
      this.source = await this.server.readTranscript(this.job.taskId, signal);
      note(new RunEvent(RunEvent.READ, `원문 ${this.source.text.length}자`, 0));
      return null;
    } catch (error) {
      return this.ending(error, '원문을 받지 못했어요', redactor);
    }
  }

  /** AI에게 줄 일: 지시문 틀 session-note를 원문으로 채운 글 하나 */
  aiJob(prompts: PromptPack): Job {
    const s = this.source;
    if (s === null) return this.job;
    return this.job.withBrief(
      prompts.fill('session-note', {
        title: s.title,
        tool: s.tool,
        project: s.project,
        transcript: s.text,
      }),
    );
  }

  async finish(
    summary: string,
    _signal: AbortSignal,
    note: Note,
    redactor: Redactor,
  ): Promise<RunEnding> {
    try {
      const saved = await this.server.saveNote(this.job.taskId, summary);
      const done = `세션 노트: ${saved}`;
      note(new RunEvent(RunEvent.WRITE, done, 0));
      return RunEnding.submit(done, RunResult.done(done, redactor));
    } catch (error) {
      return this.ending(error, '노트를 저장하지 못했어요', redactor);
    }
  }

  async requestApproval(): Promise<RunEnding | null> {
    return null;
  }

  async close(): Promise<void> {}

  /** 서버가 거절했으면 실패, 닿지 못했으면 돌려준다 (다시 빌려 이어서) */
  private ending(error: unknown, what: string, redactor: Redactor): RunEnding {
    if (error instanceof ToolRefused) {
      const why = `${what}: ${error.message}`;
      return RunEnding.submit(why, RunResult.failed(why, redactor));
    }
    if (!(error instanceof ServerUnreachable)) throw error;
    this.unreachable = true;
    return RunEnding.release(`서버에 닿지 못해 돌려줘요: ${error.message}`);
  }
}
