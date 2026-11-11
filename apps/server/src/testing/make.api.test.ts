import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ServerRunnerPolicy } from '../modules/account';
import { ApiClient, type TestUser } from './api-client';

// 만들기 작업 (결과물 2차): 주인이 고른 재료(결과물 · 위키)로 맡기고, 칸 러너가 재료 파일을 표로 받고,
// 칸 안의 AI는 작업 토큰에 봉인한 허락으로 고른 위키만 읽는다. 보는 사람별: 방문자 · 칸이 아닌 러너 · 칸 러너 · 작업 토큰 · 주인.

type Json = Record<string, unknown>;
type Download = {
  download_path: string;
  header: string;
  token: string;
  name: string;
  size: number;
  sha256: string;
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let api: ApiClient;
let owner: TestUser;
let dir: string;
let runner: string;
let slot: string;
let maker: Json;
let writer: Json;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** MCP 도구. 오류면 그 오류의 { code, message } */
async function mcp(token: string, name: string, args: Json): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.ok(res.json().result, res.text);
  const result = res.json().result as {
    isError?: boolean;
    structuredContent?: Json;
    content: { text: string }[];
  };
  if (result.isError) return { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') };
  return { ok: true, body: result.structuredContent ?? {} };
}

/** 이 작업이 올 때까지 빌린다 (다른 시험 파일이 남긴 일은 그대로 둔다). 빌린 일, 없으면 null */
async function lease(token: string, taskId: string): Promise<Json | null> {
  for (let round = 0; round < 20; round++) {
    const { body } = await mcp(token, 'next_jobs', {
      wait_seconds: 0,
      limit: 10,
      tools: ['claude'],
    });
    const jobs = body.jobs as Json[];
    const job = jobs.find((j) => (j.task as Json).id === taskId);
    if (job) return job;
    if (jobs.length === 0) return null;
  }
  return null;
}

/** 일반 러너가 맡은 일에서 결과물 하나를 올린다 (재료로 쓸 파일) */
async function anOutput(name: string, bytes: Buffer): Promise<Json> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: writer.id,
      instruction: `재료 만들기 ${randomUUID()}`,
    }),
    201,
  );
  assert.ok(await lease(runner, String(task.id)));
  const ticket = await mcp(runner, 'begin_upload', {
    task_id: task.id,
    name,
    size: bytes.length,
    sha256: sha(bytes),
  });
  assert.ok(ticket.ok, JSON.stringify(ticket.body));
  const res = await fetch(`${api.baseUrl}${ticket.body.upload_path}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'x-cairn-upload': String(ticket.body.token),
    },
    body: bytes,
  });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as Json;
}

async function aWiki(title: string): Promise<Json> {
  return ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title,
      bodyMd: `## 요약\n${title}의 본문`,
    }),
    201,
  );
}

const makeTask = async (materials: unknown, kind = 'make', agentId = maker.id) =>
  api.request('POST', '/api/tasks', owner, {
    requestId: randomUUID(),
    kind,
    agentId,
    instruction: `발표 자료 만들기 ${randomUUID()}`,
    materials,
  });

const download = (ticket: Download | null, token = ticket?.token) =>
  fetch(`${api.baseUrl}/api/outputs/download`, {
    headers: token === undefined ? {} : { 'x-cairn-download': token },
  });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cairn-make-test-'));
  process.env.CAIRN_BLOBS_DIR = dir;
  process.env.CAIRN_DISK_RESERVE_GB = '0';
  api = await ApiClient.start();
  owner = await api.signIn();
  // MCP는 사이트 주소가 있어야 연다 (다른 시험 파일이 먼저 바꿔 두었을 수 있다)
  const space = ok(await api.get('/api/space'));
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: space.name || '만들기',
      siteUrl: api.baseUrl,
      version: space.version,
    }),
  );
  runner = String(
    ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: 'make-runner',
      }),
      201,
    ).token,
  );
  const secret = api.service(ServerRunnerPolicy).codeSecret();
  slot = String(
    ok(await api.request('POST', '/api/devices/code-runner', owner, { secret, slot: '5' })).token,
  );
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  const agent = async (name: string, scopes: string[]) =>
    ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name,
        tool: 'claude',
        scopes,
      }),
      201,
    );
  writer = await agent('재료 쓰기', ['read_public']);
  // 읽기 권한 없이 make만: 재료 위키는 작업 토큰의 허락으로만 읽는다
  maker = await agent('만들기', ['make']);
});

after(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

describe('만들기 작업을 맡긴다', () => {
  test('make는 read_all · write와 함께 줄 수 없다 (422)', async () => {
    for (const scopes of [
      ['make', 'read_all'],
      ['make', 'write'],
    ]) {
      const res = await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `막힘 ${scopes.join('+')}`,
        tool: 'claude',
        scopes,
      });
      assert.equal(res.status, 422, res.text);
    }
  });

  test('재료는 payload.make가 되고 작업 상세에 보인다', async () => {
    const out = await anOutput('표지.png', Buffer.concat([PNG, randomBytes(32)]));
    const wiki = await aWiki(`재료 위키 ${randomUUID()}`);
    const task = ok(await makeTask({ outputIds: [out.id], wikiIds: [wiki.id] }), 201);
    const detail = ok(await api.get(`/api/tasks/${task.id}`, owner));
    assert.equal(detail.kind, 'make');
    assert.deepEqual((detail.payload as Json).make, { outputs: [out.id], wikis: [wiki.id] });
  });

  test('틀린 재료: 모양 400, 없는 · 휴지통의 결과물과 make가 아닌 일의 재료는 422', async () => {
    assert.equal((await makeTask({ outputIds: 'x' })).status, 400);
    assert.equal((await makeTask({ outputIds: ['not-a-uuid'] })).status, 422);
    assert.equal((await makeTask({ outputIds: [randomUUID()] })).status, 422);
    const out = await anOutput('지울 것.png', Buffer.concat([PNG, randomBytes(8)]));
    ok(await api.request('POST', `/api/outputs/${out.id}/delete`, owner, { version: out.version }));
    const trashed = await makeTask({ outputIds: [out.id] });
    assert.equal(trashed.status, 422);
    assert.match(trashed.text, /휴지통/);
    assert.equal((await makeTask({ wikiIds: [] }, 'general', writer.id)).status, 422);
  });
});

describe('칸 러너가 재료를 받고 AI가 고른 위키만 읽는다', () => {
  test('칸만 빌린다: 칸이 아닌 러너에게는 가지 않는다', async () => {
    const task = ok(await makeTask({ outputIds: [] }), 201);
    assert.equal(await lease(runner, String(task.id)), null);
    const job = await lease(slot, String(task.id));
    assert.ok(job, '칸이 빌린다');
    assert.equal((job.skill_package as Json | null)?.name ?? job.skill, 'cairn-make');
  });

  test('재료 결과물은 표로 받고, 재료가 아니거나 표가 없으면 받지 못한다', async () => {
    const bytes = Buffer.concat([PNG, randomBytes(64)]);
    const out = await anOutput('사진.png', bytes);
    const stranger = await anOutput('남의 것.png', Buffer.concat([PNG, randomBytes(16)]));
    const task = ok(await makeTask({ outputIds: [out.id] }), 201);
    assert.ok(await lease(slot, String(task.id)));

    const res = await mcp(slot, 'begin_download', { task_id: task.id, output_id: out.id });
    assert.ok(res.ok, JSON.stringify(res.body));
    const ticket = res.body as unknown as Download;
    assert.deepEqual(
      [ticket.download_path, ticket.header, ticket.name, ticket.size, ticket.sha256],
      ['/api/outputs/download', 'x-cairn-download', '사진.png', bytes.length, sha(bytes)],
    );
    const got = await download(ticket);
    assert.equal(got.status, 200);
    assert.match(String(got.headers.get('content-disposition')), /^attachment/);
    assert.equal(sha(Buffer.from(await got.arrayBuffer())), sha(bytes));

    const notMaterial = await mcp(slot, 'begin_download', {
      task_id: task.id,
      output_id: stranger.id,
    });
    assert.equal(notMaterial.ok, false);
    assert.equal(notMaterial.body.code, 'forbidden');
    const notHeld = await mcp(runner, 'begin_download', { task_id: task.id, output_id: out.id });
    assert.equal(notHeld.ok, false, '임대를 쥐지 않은 러너');
    assert.equal((await download(null)).status, 403);
    assert.equal((await download(ticket, `${ticket.token}x`)).status, 403);
    // 표를 받은 뒤 휴지통에 가면 받지 못한다
    ok(await api.request('POST', `/api/outputs/${out.id}/delete`, owner, { version: out.version }));
    assert.equal((await download(ticket)).status, 404);
    const gone = await mcp(slot, 'begin_download', { task_id: task.id, output_id: out.id });
    assert.equal(gone.body.code, 'not_found');
  });

  test('작업 토큰은 고른 위키만 읽는다: 고르지 않은 비공개 · 찾기는 안 된다', async () => {
    const chosen = await aWiki(`고른 위키 ${randomUUID()}`);
    const other = await aWiki(`고르지 않은 위키 ${randomUUID()}`);
    const task = ok(await makeTask({ wikiIds: [chosen.id] }), 201);
    const job = await lease(slot, String(task.id));
    const token = String(job?.run_token);

    const tools = (await api.mcp(token, 'tools/list', {})).json().result as { tools: Json[] };
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes('get_wiki'), '허락이 있으면 get_wiki가 열린다');
    assert.ok(!names.includes('search_wikis'), '찾기는 열리지 않는다');

    const read = await mcp(token, 'get_wiki', { wiki_id: chosen.id });
    assert.ok(read.ok, JSON.stringify(read.body));
    assert.match(String(read.body.body_md), /고른 위키/);
    const denied = await mcp(token, 'get_wiki', { wiki_id: other.id });
    assert.equal(denied.ok, false);
    const search = await mcp(token, 'search_wikis', { query: '위키' });
    assert.equal(search.ok, false);
  });
});
