import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CairnServer } from './cairn-server';
import { Job } from './job';
import { Json } from './json';
import { ServerUnreachable, ToolRefused } from './mcp-client';
import { NoteSource } from './note-source';
import { NoteStage } from './note-stage';
import { Redactor } from './redactor';
import { REPO_PROMPTS } from './testing/repo-prompts';

// 세션 노트 일 (2차 4단계): 원문은 일에 실려 오지 않는다. 러너가 vault에서 받아 지시문 틀을 채우고, AI의 답을 vault에 보낸다

const job = Job.from(
  Json.of({
    task: {
      id: 'task-note',
      kind: 'session_note',
      title: '세션 노트 · 산책 글',
      payload: { tool: 'claude' },
    },
    instruction: '세션 노트 · 산책 글',
    target: { kind: 'session', id: 'session-1', version: 2 },
    agent: null,
    run_token: null,
  }),
);
const redactor = new Redactor([]);
const quiet = () => {};

/** vault의 read_transcript · save_note 흉내 */
class FakeServer {
  readonly saved: string[] = [];

  constructor(private readonly read: () => Promise<NoteSource>) {}

  readTranscript(): Promise<NoteSource> {
    return this.read();
  }

  async saveNote(_taskId: string, answer: string): Promise<string> {
    if (!answer.includes('{')) throw new ToolRefused('invalid', '노트를 JSON으로 읽지 못했어요');
    this.saved.push(answer);
    return 'saved · 판 1';
  }
}

const stageOf = (server: FakeServer) => new NoteStage(job, server as unknown as CairnServer);
const source = new NoteSource('산책 글 써 줘', 'claude-code', 'blog', '## 사람\n산책 글 써 줘');

describe('세션 노트 일', () => {
  test('원문을 받아 지시문 틀 session-note를 채운 글 하나만 AI에게 준다', async () => {
    assert.equal(job.writesNote, true);
    assert.equal(job.prompt(REPO_PROMPTS, false), '', '원문을 받기 전에는 줄 글이 없다');
    const stage = stageOf(new FakeServer(async () => source));
    assert.equal(await stage.prepare(new AbortController().signal, quiet, redactor), null);
    const prompt = stage.aiJob(REPO_PROMPTS).prompt(REPO_PROMPTS, false);
    assert.match(prompt, /claude-code에서 한 대화의 원문이다 \(프로젝트 blog\)/);
    assert.match(prompt, /## 원문\n## 사람\n산책 글 써 줘/);
    assert.match(prompt, /JSON 하나만/);
    assert.ok(!prompt.includes('에이전트'), '에이전트 소개 · 할 일 단락이 없다');
  });

  test('AI의 답을 vault에 보내고 완료로, 서버가 읽지 못하면 실패로 끝낸다', async () => {
    const server = new FakeServer(async () => source);
    const stage = stageOf(server);
    const done = await stage.finish(
      '{"title":"산책"}',
      new AbortController().signal,
      quiet,
      redactor,
    );
    assert.equal(done.succeeded, true);
    assert.deepEqual(server.saved, ['{"title":"산책"}']);
    const bad = await stage.finish(
      '노트를 못 썼어요',
      new AbortController().signal,
      quiet,
      redactor,
    );
    assert.equal(bad.result?.status, 'failed');
    assert.match(bad.result?.error ?? '', /JSON/);
  });

  test('원문을 받지 못하면: 거절은 실패, 서버에 닿지 못하면 돌려준다', async () => {
    const refused = stageOf(
      new FakeServer(async () => {
        throw new ToolRefused('rule', '세션 노트 일이 아니에요');
      }),
    );
    const failed = await refused.prepare(new AbortController().signal, quiet, redactor);
    assert.equal(failed?.result?.status, 'failed');
    const away = stageOf(
      new FakeServer(async () => {
        throw new ServerUnreachable('끊김');
      }),
    );
    const released = await away.prepare(new AbortController().signal, quiet, redactor);
    assert.match(released?.releaseReason ?? '', /서버에 닿지 못해/);
    assert.equal(away.unreachable, true);
  });
});
