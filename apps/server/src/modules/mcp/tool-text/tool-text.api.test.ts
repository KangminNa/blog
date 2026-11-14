import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// /api/tool-texts (콘솔 "도구 설명", 2차 1-0): 보는 사람별 결과 (방문자 · write 기기 · 주인),
// 콘솔 판 쌓기 · 기본으로 되돌리기, 그리고 MCP 도구 목록(tools/list)에 그 판이 얹히는지.
// 시험이 쓰는 도구는 submit_changes (정리 권한 기기에 보이고, 배열 항목 안 칸 ops[].op가 있다). 끝에 기본 글로 되돌린다

type Json = Record<string, unknown>;
const TOOL = 'submit_changes';

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** write 권한을 준 기기. 관리 일인 도구 설명 고치기는 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;
/** 정리(tidy) 권한을 준 기기의 토큰. MCP 도구 목록에 submit_changes가 보인다 */
let tidyToken: string;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  writer = {
    authorization: `Bearer ${await api.writeDevice(owner, `tool-text-${randomUUID().slice(0, 6)}`)}`,
  };
  const name = `tool-text-tidy-${randomUUID().slice(0, 6)}`;
  tidyToken = await api.connectDevice(owner, name);
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === name) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: ['read_public', 'tidy'],
      version: device.version,
    }),
  );
});
after(() => api.close());

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const detail = async (): Promise<Json> => ok(await api.get(`/api/tool-texts/${TOOL}`, owner));

const save = (body: Json, tool = TOOL) =>
  api.request('POST', `/api/tool-texts/${tool}/revisions`, owner, {
    requestId: randomUUID(),
    note: '시험',
    ...body,
  });

/** 정리 권한 기기가 MCP로 받는 도구 목록의 submit_changes */
const listed = async (): Promise<Json & { inputSchema: { properties: Json } }> => {
  const res = await api.mcp(tidyToken, 'tools/list');
  const tools = (res.json().result as { tools: Json[] }).tools;
  const tool = tools.find((t) => t.name === TOOL);
  assert.ok(tool, `${TOOL}이 도구 목록에 없다`);
  return tool as Json & { inputSchema: { properties: Json } };
};
const opField = (tool: { inputSchema: { properties: Json } }) =>
  (tool.inputSchema.properties.ops as { items: { properties: { op: Json } } }).items.properties.op;

describe('누가 쓸 수 있나', () => {
  test('방문자와 write 기기는 도구 설명을 보지도 고치지도 못한다', async () => {
    assert.equal((await api.get('/api/tool-texts')).status, 403);
    const asWriter = await api.request(
      'GET',
      '/api/tool-texts',
      TestUser.visitor,
      undefined,
      writer,
    );
    assert.equal(asWriter.status, 403);
    const post = await api.request(
      'POST',
      `/api/tool-texts/${TOOL}/revisions`,
      TestUser.visitor,
      { requestId: randomUUID(), description: '바꿈', version: 0 },
      writer,
    );
    assert.equal(post.status, 403);
  });
});

describe('콘솔 판', () => {
  test('목록은 지금 열린 도구마다 한 줄이고, 처음에는 모두 기본 글이다', async () => {
    const { tools } = ok(await api.get('/api/tool-texts', owner)) as { tools: Json[] };
    const row = tools.find((t) => t.name === TOOL) as Json;
    assert.deepEqual(
      { origin: row.origin, source: row.source, revision: row.revision, version: row.version },
      { origin: 'core', source: 'default', revision: null, version: 0 },
    );
    for (const name of ['save_session', 'ask_agent', 'next_jobs'])
      assert.ok(
        tools.some((t) => t.name === name),
        name,
      );
    const one = await detail();
    const fields = (one.fields as Json[]).map((f) => f.path);
    assert.ok(fields.includes('ops[].op'), '배열 항목 안 칸도 고칠 수 있다');
    assert.match(String((one.default as Json).description), /.+/);
    assert.equal((await api.get('/api/tool-texts/no_such_tool', owner)).status, 404);
  });

  test('판을 쌓으면 MCP 도구 목록에 바로 얹히고, 기본으로 되돌릴 수 있다 (형식 · 길이는 코드의 것)', async () => {
    const before = await listed();
    const defaultOp = opField(before).description;
    const defaultMessage = (before.inputSchema.properties.message as Json).description;

    const saved = ok(
      await save({
        description: '바뀐 변경 묶음을 올린다 (콘솔에서 고침)',
        input: { 'ops[].op': '할 일: 고치기 · 연결 · 끊기', message: '   ' },
        version: 0,
      }),
      201,
    );
    assert.deepEqual(
      { source: saved.source, revision: saved.revision, revisions: saved.revisions },
      { source: 'console', revision: 1, revisions: 1 },
    );

    const after = await listed();
    assert.equal(after.description, '바뀐 변경 묶음을 올린다 (콘솔에서 고침)');
    assert.equal(opField(after).description, '할 일: 고치기 · 연결 · 끊기');
    assert.equal(opField(after).enum !== undefined, opField(before).enum !== undefined);
    assert.equal(
      (after.inputSchema.properties.message as Json).description,
      defaultMessage,
      '비운 칸은 기본 글',
    );

    const now = await detail();
    assert.equal(now.source, 'console');
    assert.equal((now.input as Json)['ops[].op'], '할 일: 고치기 · 연결 · 끊기');
    assert.deepEqual(
      (now.revisionList as Json[]).map((r) => r.revision),
      [1],
    );
    const one = ok(await api.get(`/api/tool-texts/${TOOL}/revisions/1`, owner));
    assert.deepEqual(one.input, { 'ops[].op': '할 일: 고치기 · 연결 · 끊기' });

    const back = ok(
      await api.request('PUT', `/api/tool-texts/${TOOL}/active`, owner, {
        revision: null,
        version: saved.version,
      }),
    );
    assert.equal(back.source, 'default');
    const reverted = await listed();
    assert.equal(reverted.description, before.description, '기본 글로 돌아왔다');
    assert.equal(opField(reverted).description, defaultOp);
  });

  test('틀린 글은 422 · 모양이 틀리면 400 · 없는 도구는 404 · 본 version이 다르면 409. 쌓인 판은 DB도 고치지 못한다', async () => {
    const { version } = await detail();
    for (const [label, body] of [
      ['없는 칸', { description: '설명', input: { ghost: '없는 칸' } }],
      ['빈 설명', { description: '   ' }],
    ] as const) {
      const res = await save({ ...body, version });
      assert.equal(res.status, 422, `${label}: ${res.text}`);
    }
    assert.equal((await save({ description: 'x'.repeat(4001), version })).status, 400);
    assert.equal((await save({ description: '설명', input: { message: 3 }, version })).status, 400);
    assert.equal((await save({ description: '설명', version: 0 }, 'no_such_tool')).status, 404);
    assert.equal((await save({ description: '설명', version: Number(version) + 5 })).status, 409);

    const requestId = randomUUID();
    const once = ok(await save({ description: '한 번', version, requestId }), 201);
    const again = ok(await save({ description: '한 번', version, requestId }), 201);
    assert.equal(again.revisions, once.revisions, '같은 requestId는 판 하나');
    await assert.rejects(db.sql`UPDATE mcp.tool_text_revisions SET note = 'x'`);
    await assert.rejects(db.sql`DELETE FROM mcp.tool_text_revisions`);
    ok(
      await api.request('PUT', `/api/tool-texts/${TOOL}/active`, owner, {
        revision: null,
        version: once.version,
      }),
    );
  });
});
