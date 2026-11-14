import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { OutboxWorker } from '../../platform';

// 모으기 (2차 4단계 · 서브나 8장): 수집 훅 · 확장이 원문을 올리면(save_transcript) 노트 없는 세션이 생기고,
// 서버 러너가 세션 노트 일을 빌려 원문을 받고(read_transcript) AI의 답(JSON)을 보내면(save_note) 노트의 판이 된다.
// 원문은 작업에 실리지 않는다: 일을 쥔 러너만 vault에서 받아 간다

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let runner: string;
let otherRunner: string;
let collector: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  return result.isError
    ? { ok: false, message: String(result.content[0]?.text ?? '') }
    : { ok: true, ...(result.structuredContent ?? {}) };
}

const drain = async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
};

const upload = (text: string, more: Json = {}) =>
  tool(collector, 'save_transcript', {
    request_id: randomUUID(),
    tool: 'claude-code',
    source_session_id: `sess-${randomUUID()}`,
    text,
    ...more,
  });

/** 러너가 세션 노트 일을 빌린다 (같은 DB의 다른 일이 먼저 올 수 있다) */
async function leasedNote(sessionId: string, version: number): Promise<Json> {
  await drain();
  for (let round = 0; round < 10; round++) {
    const next = await tool(runner, 'next_jobs', {
      wait_seconds: 0,
      limit: 10,
      tools: ['claude'],
      own_logins: [],
    });
    const job = (next.jobs as Json[]).find(
      (j) =>
        j.task.kind === 'session_note' &&
        j.target?.id === sessionId &&
        j.target?.version === version,
    );
    if (job) return job;
  }
  throw new Error(`세션 노트 일을 빌리지 못했다: ${sessionId} ${version}`);
}

const NOTE = JSON.stringify({
  title: '산책 글 초안을 썼다',
  did: ['성수동 산책 글 초안', '사진 여덟 장 골라 둠'],
  decisions: '공개는 결재로',
  blocked: [],
  quotes: '',
  extra: '',
  tags: ['블로그', '산책'],
});

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const { version } = (await api.get('/api/space')).json() as { version: number };
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: '모으기',
      siteUrl: api.baseUrl,
      version,
    }),
  );
  const made = async (name: string) =>
    String(
      ok(
        await api.request('POST', '/api/devices/runner', owner, { requestId: randomUUID(), name }),
        201,
      ).token,
    );
  runner = await made(`모으기 러너 ${randomUUID().slice(0, 6)}`);
  otherRunner = await made(`모으기 다른 러너 ${randomUUID().slice(0, 6)}`);
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  collector = await api.connectDevice(owner, '노트북 · 세션 저장', 'collect');
});
after(() => api.close());

describe('원문 올리기 (save_transcript)', () => {
  test('원문이 오면 노트 없는 세션 · 원문 1번이 생긴다. 비밀값은 지우고, 같은 원문은 쌓지 않는다', async () => {
    const sid = `sess-${randomUUID()}`;
    const text = `## 사람\n산책 글 써 줘. 키는 sk-ant-api03-${'x'.repeat(40)}\n\n## AI\n초안을 썼어요 (도구: Write)`;
    const first = await upload(text, {
      source_session_id: sid,
      project: 'blog',
      title: '산책 글 써 줘',
    });
    assert.equal(first.status, 'saved', first.message);
    assert.equal(first.seq, 1);
    assert.equal((first.warnings as Json[]).length, 1, '지운 비밀값을 알려 준다');
    const again = await upload(text, { source_session_id: sid, project: 'blog' });
    assert.deepEqual(
      [again.status, again.session_id, again.seq],
      ['unchanged', first.session_id, 1],
    );

    const shown = ok(await api.get(`/api/sessions/${first.session_id}`, owner));
    assert.equal(shown.head, null, '노트는 아직 없다');
    assert.deepEqual(
      [shown.title, shown.revisionCount, shown.transcriptCount, shown.project],
      ['산책 글 써 줘', 0, 1, 'blog'],
    );
    assert.equal(shown.transcripts[0].redactions, 1);
    const raw = ok(await api.get(`/api/sessions/${first.session_id}/transcripts/1`, owner));
    assert.ok(!raw.text.includes('sk-ant-api03'), '지운 글만 남는다');
    assert.match(raw.text, /\[지움/);
    assert.equal((await api.get(`/api/sessions/${first.session_id}/transcripts/1`)).status, 403);
  });

  test('수집 기기는 올리기만 한다 (읽기 · 맡기기 도구는 막힌다)', async () => {
    const read = await tool(collector, 'search_wikis', { query: '산책' });
    assert.equal(read.ok, false);
    const ask = await tool(collector, 'ask_agent', { request_id: randomUUID(), message: '안녕' });
    assert.equal(ask.ok, false);
  });
});

describe('세션 노트 일', () => {
  test('러너가 빌려 원문을 받고 답을 보내면 노트의 판이 된다. 원문은 작업에 실리지 않는다', async () => {
    const text = `## 사람\n성수동 산책 글 ${randomUUID()}\n\n## AI\n초안을 썼어요`;
    const saved = await upload(text, { title: '성수동 산책' });
    const job = await leasedNote(saved.session_id, 1);
    assert.equal(job.task.agent_id ?? null, null, '에이전트 없이 돈다');
    assert.equal(job.run_token ?? null, null, '작업 토큰이 없다 (MCP 없이 답만)');
    assert.ok(!JSON.stringify(job).includes('초안을 썼어요'), '원문은 일에 실리지 않는다');
    assert.ok(job.prompt_package, '러너가 채울 지시문 틀을 함께 받는다');

    const other = await tool(otherRunner, 'read_transcript', { task_id: job.task.id });
    assert.equal(other.ok, false, '일을 쥐지 않은 러너는 받지 못한다');
    const source = await tool(runner, 'read_transcript', { task_id: job.task.id });
    assert.deepEqual(
      [source.session_id, source.seq, source.tool, source.title],
      [saved.session_id, 1, 'claude-code', '성수동 산책'],
    );
    assert.match(source.text, /초안을 썼어요/);

    const bad = await tool(runner, 'save_note', {
      task_id: job.task.id,
      answer: '노트를 못 썼어요',
    });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /JSON/);
    const note = await tool(runner, 'save_note', {
      task_id: job.task.id,
      answer: `노트예요\n\`\`\`json\n${NOTE}\n\`\`\``,
    });
    assert.deepEqual([note.status, note.seq], ['saved', 1]);
    const twice = await tool(runner, 'save_note', { task_id: job.task.id, answer: NOTE });
    assert.equal(twice.status, 'unchanged', '같은 답은 판을 하나만');

    const shown = ok(await api.get(`/api/sessions/${saved.session_id}`, owner));
    assert.equal(shown.title, '산책 글 초안을 썼다');
    assert.equal(shown.revisionCount, 1);
    assert.deepEqual([shown.history[0].kind, shown.history[0].actorType], ['origin', 'ai']);
    const did = (shown.head.sections as Json[]).find((s) => s.name === 'did');
    assert.equal(did?.text, '- 성수동 산책 글 초안\n- 사진 여덟 장 골라 둠');
    assert.deepEqual(shown.head.tags, ['블로그', '산책']);

    const done = await tool(runner, 'submit_result', {
      task_id: job.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '세션 노트: saved · 판 1' },
    });
    assert.equal(done.ok, true, done.message);
    const after = await tool(runner, 'read_transcript', { task_id: job.task.id });
    assert.equal(after.ok, false, '끝난 일의 원문은 받지 못한다');
  });

  test('원문이 바뀌면 새 원문 · 새 노트 일. 늦게 온 옛 원문의 노트는 쌓지 않는다 (skipped)', async () => {
    const sid = `sess-${randomUUID()}`;
    const first = await upload('## 사람\n첫 원문', { source_session_id: sid });
    const firstJob = await leasedNote(first.session_id, 1);
    const second = await upload('## 사람\n첫 원문\n\n## 사람\n이어서 한 말', {
      source_session_id: sid,
    });
    assert.deepEqual([second.session_id, second.seq], [first.session_id, 2]);
    const secondJob = await leasedNote(first.session_id, 2);

    const newer = await tool(runner, 'save_note', {
      task_id: secondJob.task.id,
      answer: JSON.stringify({ title: '이어서 한 일', did: '두 번째', tags: [] }),
    });
    assert.equal(newer.status, 'saved');
    const older = await tool(runner, 'save_note', {
      task_id: firstJob.task.id,
      answer: JSON.stringify({ title: '첫 일', did: '첫 번째', tags: [] }),
    });
    assert.equal(older.status, 'skipped');
    const shown = ok(await api.get(`/api/sessions/${first.session_id}`, owner));
    assert.deepEqual(
      [shown.title, shown.revisionCount, shown.transcriptCount],
      ['이어서 한 일', 1, 2],
    );
  });

  test('세션 노트 일이 아닌 일로는 원문을 받지 못한다', async () => {
    const res = await tool(runner, 'read_transcript', { task_id: randomUUID() });
    assert.equal(res.ok, false);
    const note = await tool(collector, 'save_note', { task_id: randomUUID(), answer: NOTE });
    assert.equal(note.ok, false, '러너가 아닌 기기는 노트를 보내지 못한다');
  });
});
