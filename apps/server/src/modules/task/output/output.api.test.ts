import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type TestUser } from '../../../testing/api-client';
import { BlobStore, Database, SystemActor } from '../../platform';
import { OutputPurgeJob } from './output-purge.job';

// 결과물: 러너가 begin_upload로 표를 받아 PUT api/outputs/upload로 파일을 보내고, 주인이 결과물 메뉴에서 보고 지운다.
// 공간 한도는 시험에서 64KB로, 디스크 여유는 0으로 둔다 (서버 설정 CAIRN_OUTPUTS_MAX_GB · CAIRN_DISK_RESERVE_GB).

type Json = Record<string, unknown>;
type Ticket = { upload_path: string; header: string; token: string; expires_at: string };

const GB = 1024 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let api: ApiClient;
let owner: TestUser;
let dir: string;
let runner: string;
let other: string;
let agent: Json;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const png = (size = 64) => Buffer.concat([PNG, randomBytes(size)]);

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

/** 일을 하나 만들어 러너가 빌린다 */
async function leased(): Promise<string> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      instruction: `결과물 시험 ${randomUUID()}`,
    }),
    201,
  );
  // 같은 DB를 쓰는 다른 시험 파일이 남긴 일이 먼저 올 수 있다: 이 일이 올 때까지 빌린다 (먼저 온 일은 그대로 둔다)
  for (let round = 0; round < 20; round++) {
    const { body } = await mcp(runner, 'next_jobs', {
      wait_seconds: 0,
      limit: 10,
      tools: ['claude'],
    });
    const jobs = body.jobs as Json[];
    if (jobs.some((j) => (j.task as Json).id === task.id)) return String(task.id);
    if (jobs.length === 0) break;
  }
  throw new Error('빌린 일이 없다');
}

async function ticketFor(
  taskId: string,
  name: string,
  bytes: Buffer,
  as = runner,
): Promise<Ticket> {
  const res = await mcp(as, 'begin_upload', {
    task_id: taskId,
    name,
    size: bytes.length,
    sha256: sha(bytes),
  });
  assert.ok(res.ok, JSON.stringify(res.body));
  return res.body as unknown as Ticket;
}

async function put(ticket: Ticket | null, body: Buffer, token = ticket?.token): Promise<Response> {
  return fetch(`${api.baseUrl}/api/outputs/upload`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      ...(token === undefined ? {} : { 'x-cairn-upload': token }),
    },
    body,
  });
}

async function upload(taskId: string, name: string, bytes: Buffer): Promise<Json> {
  const res = await put(await ticketFor(taskId, name, bytes), bytes);
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as Json;
}

const list = async (query = '', as = owner) => ok(await api.get(`/api/outputs${query}`, as));

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cairn-output-test-'));
  process.env.CAIRN_BLOBS_DIR = dir;
  process.env.CAIRN_OUTPUTS_MAX_GB = String((64 * 1024) / GB);
  process.env.CAIRN_DISK_RESERVE_GB = '0';
  api = await ApiClient.start();
  owner = await api.signIn();
  // MCP는 사이트 주소가 있어야 연다 (다른 시험 파일이 먼저 바꿔 두었을 수 있다)
  const space = ok(await api.get('/api/space'));
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: space.name || '결과물',
      siteUrl: api.baseUrl,
      version: space.version,
    }),
  );
  const device = async (name: string) =>
    String(
      ok(
        await api.request('POST', '/api/devices/runner', owner, { requestId: randomUUID(), name }),
        201,
      ).token,
    );
  runner = await device('output-runner');
  other = await device('other-runner');
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '결과물',
      tool: 'claude',
      scopes: ['read_public'],
    }),
    201,
  );
});

after(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

describe('러너가 결과물을 올린다', () => {
  test('표를 받아 파일을 보내면 결과물 하나: 목록 · 작업 상세에 보이고 종류 · 형식은 앞부분으로 정한다', async () => {
    const taskId = await leased();
    const bytes = png();
    const saved = await upload(taskId, '표지.png', bytes);
    assert.equal(saved.name, '표지.png');
    assert.equal(saved.kind, 'image');
    assert.equal(saved.mime, 'image/png');
    assert.equal(saved.sizeBytes, bytes.length);

    const page = await list();
    const row = (page.outputs as Json[]).find((o) => o.id === saved.id);
    assert.equal(row?.runSeq, 1);
    assert.match(String(row?.taskTitle), /결과물 시험/);
    assert.ok(Number((page.usage as Json).usedBytes) >= bytes.length);
    const task = ok(await api.get(`/api/tasks/${taskId}`, owner));
    assert.deepEqual(
      (task.outputs as Json[]).map((o) => o.name),
      ['표지.png'],
    );
    // 앞부분에 표시가 없는 글자 파일은 이름으로
    const md = await upload(taskId, '요약.md', Buffer.from('# 요약\n본문'));
    assert.deepEqual([md.kind, md.mime], ['document', 'text/markdown']);
    // 이름이 png여도 내용이 HTML이면 그림으로 보지 않는다
    const fake = await upload(taskId, 'fake.png', Buffer.from('<script>alert(1)</script>'));
    assert.deepEqual(
      [fake.kind, fake.mime],
      ['other', 'application/octet-stream'],
      '그림인지는 내용으로만 정한다',
    );
  });

  test('같은 표로 다시 보내면 같은 줄, 같은 이름에 다른 내용은 409', async () => {
    const taskId = await leased();
    const bytes = png();
    const ticket = await ticketFor(taskId, 'a.png', bytes);
    const first = (await (await put(ticket, bytes)).json()) as Json;
    const again = await put(ticket, bytes);
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as Json).id, first.id);
    const changed = png();
    const res = await put(await ticketFor(taskId, 'a.png', changed), changed);
    assert.equal(res.status, 409);
  });

  test('표가 없거나 틀리면 403, 본문이 표보다 크면 413, 내용이 다르면 422: 아무것도 남지 않는다', async () => {
    const taskId = await leased();
    const bytes = png();
    const ticket = await ticketFor(taskId, 'b.png', bytes);
    assert.equal((await put(null, bytes)).status, 403);
    // 가운데 한 글자를 바꾼 표 (끝에 붙인 글자는 base64가 버려 같은 표가 된다)
    const middle = Math.floor(ticket.token.length / 2);
    const flipped = ticket.token[middle] === 'A' ? 'B' : 'A';
    const tampered = `${ticket.token.slice(0, middle)}${flipped}${ticket.token.slice(middle + 1)}`;
    assert.equal((await put(ticket, bytes, tampered)).status, 403);
    assert.equal((await put(ticket, Buffer.concat([bytes, Buffer.from([1])]))).status, 413);
    const swapped = Buffer.from(bytes);
    swapped[swapped.length - 1] = (swapped.at(-1) ?? 0) ^ 0xff;
    assert.equal((await put(ticket, swapped)).status, 422);
    assert.equal(await api.service(BlobStore).find(sha(swapped)), null);
    const task = ok(await api.get(`/api/tasks/${taskId}`, owner));
    assert.deepEqual(task.outputs, []);
  });

  test('임대를 쥐지 않은 러너는 표를 받지 못하고, 이름 규칙 · 공간 한도를 넘으면 422', async () => {
    const taskId = await leased();
    const bytes = png();
    const stranger = await mcp(other, 'begin_upload', {
      task_id: taskId,
      name: 'c.png',
      size: bytes.length,
      sha256: sha(bytes),
    });
    assert.equal(stranger.ok, false);
    assert.equal(stranger.body.code, 'rule_violation');
    for (const name of ['../x.png', 'a/b.png', '.hidden', ' 앞뒤 ', 'a\nb'])
      assert.equal(
        (
          await mcp(runner, 'begin_upload', {
            task_id: taskId,
            name,
            size: bytes.length,
            sha256: sha(bytes),
          })
        ).ok,
        false,
        JSON.stringify(name),
      );
    const big = randomBytes(70 * 1024);
    const full = await mcp(runner, 'begin_upload', {
      task_id: taskId,
      name: 'big.bin',
      size: big.length,
      sha256: sha(big),
    });
    assert.equal(full.ok, false);
    assert.match(String(full.body.message), /저장 공간/);
  });
});

describe('주인이 결과물을 본다', () => {
  let taskId: string;
  let image: Json;
  let note: Json;

  before(async () => {
    taskId = await leased();
    image = await upload(taskId, '그림.png', png());
    note = await upload(taskId, '메모.md', Buffer.from('<html><script>alert(1)</script>'));
  });

  test('내려받기는 늘 attachment + sandbox, 한글 이름은 filename*. 미리 보기는 앞부분으로 알아본 그림 · PDF · 영상만', async () => {
    const res = await fetch(`${api.baseUrl}/api/outputs/${note.id}/file`, {
      headers: { cookie: owner.header },
    });
    assert.equal(res.status, 200);
    const disposition = String(res.headers.get('content-disposition'));
    assert.match(disposition, /^attachment;/);
    assert.match(disposition, /filename\*=UTF-8''%EB%A9%94%EB%AA%A8\.md/);
    assert.match(String(res.headers.get('content-security-policy')), /sandbox/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const inline = await fetch(`${api.baseUrl}/api/outputs/${image.id}/file?inline=1`, {
      headers: { cookie: owner.header },
    });
    assert.equal(inline.status, 200);
    assert.match(String(inline.headers.get('content-disposition')), /^inline;/);
    const refused = await fetch(`${api.baseUrl}/api/outputs/${note.id}/file?inline=1`, {
      headers: { cookie: owner.header },
    });
    assert.equal(refused.status, 422);
  });

  test('view=1: HTML은 페이지처럼 격리해서 열고(스크립트는 돌지만 다른 출처), 그림은 미리 보기, 나머지는 내려받기', async () => {
    // 다른 작업에 올린다: 아래 시험들이 이 작업의 결과물 수를 센다
    const page = await upload(
      await leased(),
      '발표.html',
      Buffer.from('<!doctype html><h1>발표</h1>'),
    );
    assert.deepEqual([page.kind, page.mime], ['document', 'text/html']);
    const get = (id: unknown, query: string) =>
      fetch(`${api.baseUrl}/api/outputs/${id}/file${query}`, { headers: { cookie: owner.header } });
    const opened = await get(page.id, '?view=1');
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(String(opened.headers.get('content-disposition')), /^inline;/);
    const csp = String(opened.headers.get('content-security-policy'));
    assert.match(csp, /^sandbox allow-scripts /);
    assert.doesNotMatch(
      csp,
      /allow-same-origin/,
      '다른 출처로 취급: 로그인 쿠키 · API에 닿지 못한다',
    );
    assert.match(csp, /frame-ancestors 'self'/);
    const saved = await get(page.id, '');
    assert.match(
      String(saved.headers.get('content-disposition')),
      /^attachment;/,
      'view 없이는 내려받기',
    );
    assert.match(
      String(saved.headers.get('content-security-policy')),
      /^sandbox; default-src 'none'/,
    );
    assert.match(
      String((await get(image.id, '?view=1')).headers.get('content-disposition')),
      /^inline;/,
    );
    const md = await get(note.id, '?view=1');
    assert.match(
      String(md.headers.get('content-disposition')),
      /^attachment;/,
      '이름이 .md면 HTML로 열지 않는다',
    );
    assert.equal((await fetch(`${api.baseUrl}/api/outputs/${page.id}/file?view=1`)).status, 403);
  });

  test('방문자 · write 기기는 목록도 파일도 볼 수 없다', async () => {
    const visitor = await api.get('/api/outputs');
    assert.equal(visitor.status, 403);
    assert.equal((await api.get(`/api/outputs/${image.id}/file`)).status, 403);
    // write 기기 토큰은 REST에서 요청자가 되지 않는다 (/mcp에서만)
    const writer = await api.writeDevice(owner, 'output-writer');
    const asWriter = await fetch(`${api.baseUrl}/api/outputs`, {
      headers: { authorization: `Bearer ${writer}` },
    });
    assert.equal(asWriter.status, 403);
  });

  test('종류 · 작업으로 거르고, 지우면 휴지통으로 · 되살리기 · 휴지통에서만 바로 지우기', async () => {
    const images = await list(`?kind=image&taskId=${taskId}`);
    assert.deepEqual(
      (images.outputs as Json[]).map((o) => o.name),
      ['그림.png'],
    );
    assert.equal(
      (
        await api.request('POST', `/api/outputs/${image.id}/purge`, owner, {
          version: image.version,
        })
      ).status,
      422,
      '휴지통이 아니면 바로 지우지 않는다',
    );
    const trashed = ok(
      await api.request('POST', `/api/outputs/${image.id}/delete`, owner, {
        version: image.version,
      }),
    );
    assert.ok(trashed.deletedAt);
    assert.equal(
      (
        await api.request('POST', `/api/outputs/${image.id}/restore`, owner, {
          version: image.version,
        })
      ).status,
      409,
    );
    assert.deepEqual(
      ((await list('?trash=1')).outputs as Json[]).map((o) => o.id),
      [image.id],
    );
    const task = ok(await api.get(`/api/tasks/${taskId}`, owner));
    assert.deepEqual(
      (task.outputs as Json[]).map((o) => o.name),
      ['메모.md'],
      '작업 상세에는 휴지통 것이 없다',
    );
    const back = ok(
      await api.request('POST', `/api/outputs/${image.id}/restore`, owner, {
        version: trashed.version,
      }),
    );
    assert.equal(back.deletedAt, null);
    const again = ok(
      await api.request('POST', `/api/outputs/${image.id}/delete`, owner, {
        version: back.version,
      }),
    );
    const purged = await api.request('POST', `/api/outputs/${image.id}/purge`, owner, {
      version: again.version,
    });
    assert.equal(purged.status, 204, purged.text);
    assert.equal(((await list('?trash=1')).outputs as Json[]).length, 0);
  });

  test('일꾼은 30일 지난 휴지통을 지우고, 아무도 쓰지 않게 된 파일은 sweep이 지운다', async () => {
    const saved = ok(
      await api.request('POST', `/api/outputs/${note.id}/delete`, owner, { version: note.version }),
    );
    const db = api.service(Database);
    await db.sql`UPDATE task.outputs SET purge_after = now() - interval '1 minute' WHERE id = ${String(saved.id)}`;
    await api.service(OutputPurgeJob).run();
    const [row] = await db.sql`SELECT 1 FROM task.outputs WHERE id = ${String(saved.id)}`;
    assert.equal(row, undefined);
    // 기다림(7일)을 건너뛰려고 기준 시각을 미래로: 결과물이 더는 가리키지 않는 파일만 지워진다
    const hash = sha(Buffer.from('<html><script>alert(1)</script>'));
    const blobs = api.service(BlobStore);
    await blobs.sweep(new SystemActor(), new Date(Date.now() + 60_000));
    assert.equal(await blobs.find(hash), null);
    const kept = ok(await api.get(`/api/tasks/${taskId}`, owner)).outputs as Json[];
    assert.deepEqual(kept, [], '그림은 앞 시험에서 지웠다');
  });
});
