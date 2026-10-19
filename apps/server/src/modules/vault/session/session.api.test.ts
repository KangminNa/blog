import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

// 세션 저장 (M1 C). AI 도구가 MCP save_session으로 올리고, 주인이 관리 화면(api/sessions)에서 본다.
// M1 끝 기준: 같은 세션을 50번 동시에 저장하면 판 50개, 유실 0.

let api: ApiClient;
let owner: TestUser;
let site: string;
let laptop: string;

/** save_session 한 번. AI 도구가 받는 결과(성공이면 structuredContent, 실패면 오류 JSON) */
async function save(
  token: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await api.mcp(token, 'tools/call', { name: 'save_session', arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Record<string, unknown>;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, body: result.structuredContent ?? {} };
}

function note(source: string, did: string, more: Record<string, unknown> = {}) {
  return {
    request_id: randomUUID(),
    source_session_id: source,
    tool: 'claude-code',
    project: 'cairn',
    title: '세션 저장 만들기',
    did,
    ...more,
  };
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  site = api.baseUrl;
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '돌무더기', siteUrl: site, version });
  laptop = await api.connectDevice(owner, 'session-laptop');
});
after(() => api.close());

/** check_session 한 번 (저장 전 검사) */
async function check(token: string, args: Record<string, unknown>) {
  const res = await api.mcp(token, 'tools/call', { name: 'check_session', arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Record<string, unknown>;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown> }
    : { ok: true, body: result.structuredContent ?? {} };
}

describe('check_session (저장 전 검사)', () => {
  test('대화 id가 없으면 만들어 주고, 저장에 쓸 request_id와 올릴 곳을 준다. 아무것도 저장하지 않는다', async () => {
    const before = (await api.get('/api/sessions', owner)).json().sessions as unknown[];
    const res = await check(laptop, { title: '앱에서 쓴 노트', did: '검사만 했다' });
    assert.equal(res.ok, true, JSON.stringify(res.body));
    assert.match(String(res.body.request_id), /^[0-9a-f-]{36}$/);
    assert.match(String(res.body.source_session_id), /^conv-[0-9a-f-]{36}$/);
    assert.equal(res.body.site, site);
    assert.equal(res.body.existing, null);
    assert.deepEqual(res.body.limits, { section_max: 20_000, quotes_max: 4_000 });
    const after = (await api.get('/api/sessions', owner)).json().sessions as unknown[];
    assert.equal(after.length, before.length, '검사는 저장하지 않는다');
  });

  test('저장하면 지울 비밀값을 미리 알려 주고, 같은 대화로 저장한 세션이 있으면 판 수를 알려 준다', async () => {
    const first = await check(laptop, {
      title: '검사',
      did: 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 를 썼다',
    });
    assert.deepEqual(first.body.warnings, [
      { kind: 'secret', section: 'did', label: 'GitHub 토큰' },
    ]);
    const saved = await save(laptop, note('conv-checked', '저장한다'));
    assert.equal(saved.body.status, 'saved');
    const again = await check(laptop, {
      source_session_id: 'conv-checked',
      tool: 'claude-code',
      title: '다시',
      did: '더 했다',
    });
    assert.deepEqual(again.body.existing, { session_id: saved.body.session_id, revisions: 1 });
    assert.equal(again.body.source_session_id, 'conv-checked', '받은 대화 id는 그대로');
  });

  test('모양이 틀리면 save_session과 같은 모양으로 고칠 칸을 알려 준다', async () => {
    const res = await check(laptop, { did: '제목 없음', quotes: 'ㄱ'.repeat(4001) });
    assert.equal(res.ok, false);
    assert.deepEqual(res.body.fields, {
      title: '필수 문자열이에요',
      quotes: '4000자 이하여야 해요',
    });
    const empty = await check(laptop, { title: '칸이 없다' });
    assert.equal(empty.body.code, 'rule_violation');
  });
});

describe('save_session (AI 도구)', () => {
  test('도구 목록에 입력 모양과 함께 보인다', async () => {
    const res = await api.mcp(laptop, 'tools/list');
    const tool = (
      res.json().result as { tools: { name: string; inputSchema: { required: string[] } }[] }
    ).tools.find((t) => t.name === 'save_session');
    assert.deepEqual(tool?.inputSchema.required, [
      'request_id',
      'source_session_id',
      'tool',
      'title',
    ]);
  });

  test('처음 저장 → saved 1번 판. 같은 request_id를 다시 보내면 처음 결과 그대로 (duplicate)', async () => {
    const args = note('conv-first', '저장 API를 만들었다', { quotes: '> 판은 추가만 한다' });
    const first = await save(laptop, args);
    assert.equal(first.ok, true, JSON.stringify(first.body));
    assert.equal(first.body.status, 'saved');
    assert.equal(first.body.revision, 1);
    assert.equal(first.body.url, `${site}/?sheet=sessions&session=${first.body.session_id}`);

    const again = await save(laptop, args);
    assert.deepEqual(again.body, { ...first.body, status: 'duplicate' });
  });

  test('같은 대화: 같은 내용이면 unchanged(판 없음), 바뀐 내용이면 다음 판', async () => {
    const first = await save(laptop, note('conv-grow', '하나'));
    const same = await save(laptop, note('conv-grow', '하나'));
    assert.deepEqual([same.body.status, same.body.revision], ['unchanged', 1]);
    const next = await save(laptop, note('conv-grow', '하나, 그리고 둘'));
    assert.deepEqual([next.body.status, next.body.revision], ['saved', 2]);
    assert.equal(next.body.session_id, first.body.session_id);
  });

  test('비밀값은 판이 되기 전에 지우고 warnings로 알린다. 저장된 판에도 값이 없다', async () => {
    const secret = `gh${'p_'}${'Q7w8E9r0'.repeat(5)}`;
    const saved = await save(laptop, note('conv-secret', `토큰 ${secret} 으로 푸시했다`));
    assert.deepEqual(saved.body.warnings, [
      { kind: 'secret', section: 'did', label: 'GitHub 토큰' },
    ]);
    const detail = await api.get(`/api/sessions/${saved.body.session_id}`, owner);
    assert.equal(detail.text.includes(secret), false);
    assert.match(detail.text, /\[지움: GitHub 토큰\]/);
  });

  test('모양이 틀리면 고칠 필드를 알려준다: 인용 4,000자 초과, 제목 없음', async () => {
    const res = await save(laptop, {
      ...note('conv-bad', '일'),
      title: undefined,
      quotes: 'ㄱ'.repeat(4001),
    });
    assert.equal(res.ok, false);
    assert.equal(res.body.code, 'invalid_request');
    assert.deepEqual(res.body.fields, {
      title: '필수 문자열이에요',
      quotes: '4000자 이하여야 해요',
    });
  });

  test('칸마다 한도까지 한글로 채워도(요청 약 250KB) 저장된다', async () => {
    const full = '가'.repeat(20_000);
    const args = note('conv-big', full, {
      project: 'big',
      decisions: full,
      blocked: full,
      extra: full,
      quotes: '나'.repeat(4_000),
    });
    assert.ok(Buffer.byteLength(JSON.stringify(args)) > 240_000);
    const res = await save(laptop, args);
    assert.equal(res.ok, true, JSON.stringify(res.body));
    assert.equal(res.body.status, 'saved');
  });

  test('다른 기기가 같은 대화 id를 보내면 다른 세션', async () => {
    const desktop = await api.connectDevice(owner, 'session-desktop');
    const a = await save(laptop, note('conv-shared', '노트북'));
    const b = await save(desktop, note('conv-shared', '데스크톱'));
    assert.notEqual(a.body.session_id, b.body.session_id);
    assert.equal(b.body.revision, 1);
  });

  test('올리기 권한을 끄면 도구가 목록에서 사라지고, 불러도 403 모양의 오류', async () => {
    const token = await api.connectDevice(owner, 'session-readonly');
    const devices = (await api.get('/api/devices', owner)).json().devices as {
      id: string;
      name: string;
      version: number;
    }[];
    const device = devices.find((d) => d.name === 'session-readonly');
    const changed = await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: ['read_public'],
      version: device?.version,
    });
    assert.equal(changed.status, 200, changed.text);
    const tools = (await api.mcp(token, 'tools/list')).json().result as { tools: unknown[] };
    assert.deepEqual(tools.tools, []);
    const res = await save(token, note('conv-denied', '일'));
    assert.deepEqual([res.ok, res.body.code, res.body.scope], [false, 'forbidden', 'upload']);
  });

  test('같은 세션을 50번 동시에 저장하면 판 50개, 유실 0', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => save(laptop, note('conv-race', `동시 저장 ${i}`))),
    );
    assert.equal(results.filter((r) => r.body.status === 'saved').length, 50);
    const ids = new Set(results.map((r) => r.body.session_id));
    assert.equal(ids.size, 1, '세션은 하나');
    const seqs = results.map((r) => Number(r.body.revision)).sort((a, b) => a - b);
    assert.deepEqual(
      seqs,
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    const detail = (await api.get(`/api/sessions/${[...ids][0]}`, owner)).json();
    assert.equal(detail.revisionCount, 50);
    assert.equal((detail.history as unknown[]).length, 50);
  });
});

describe('관리 화면 API (api/sessions)', () => {
  test('방문자와 올리기만 할 수 있는 기기는 403, 주인은 최근 저장 순서로', async () => {
    assert.equal((await api.get('/api/sessions')).status, 403);
    const asDevice = await fetch(`${site}/api/sessions`, {
      headers: { authorization: `Bearer ${laptop}` },
    });
    assert.equal(asDevice.status, 403);

    const latest = await save(laptop, note('conv-latest', '가장 최근'));
    const list = (await api.get('/api/sessions', owner)).json();
    const first = (list.sessions as Record<string, unknown>[])[0];
    assert.equal(first?.id, latest.body.session_id);
    assert.equal(first?.title, '세션 저장 만들기');
    assert.equal(first?.project, 'cairn');
    assert.equal(first?.visibility, 'private');
  });

  test('프로젝트로 거르고, next로 다음 쪽 (한 쪽 30개)', async () => {
    await Promise.all(
      Array.from({ length: 31 }, (_, i) =>
        save(laptop, note(`conv-page-${i}`, `쪽 나누기 ${i}`, { project: 'paging' })),
      ),
    );
    const page1 = (await api.get('/api/sessions?project=paging', owner)).json();
    assert.equal((page1.sessions as unknown[]).length, 30);
    assert.equal(typeof page1.next, 'string');
    const page2 = (
      await api.get(`/api/sessions?project=paging&cursor=${page1.next}`, owner)
    ).json();
    assert.equal((page2.sessions as unknown[]).length, 1);
    assert.equal(page2.next, null);
    assert.equal((await api.get('/api/sessions?cursor=nope', owner)).status, 400);
  });

  test('세션 하나: 지금 판의 칸·판 기록, 지난 판 보기. 없는 세션은 404, 틀린 id는 400', async () => {
    const first = await save(laptop, note('conv-detail', '처음', { tags: ['nest', 'mcp'] }));
    await save(laptop, note('conv-detail', '고친 뒤', { decisions: '판은 추가만' }));
    const id = String(first.body.session_id);

    const detail = (await api.get(`/api/sessions/${id}`, owner)).json();
    assert.equal(detail.sourceSessionId, 'conv-detail');
    assert.equal(detail.revisionCount, 2);
    const head = detail.head as { seq: number; sections: { name: string; text: string }[] };
    assert.equal(head.seq, 2);
    assert.deepEqual(
      head.sections.filter((s) => s.text).map((s) => [s.name, s.text]),
      [
        ['did', '고친 뒤'],
        ['decisions', '판은 추가만'],
      ],
    );
    assert.deepEqual(
      (detail.history as { seq: number; kind: string; actorType: string }[]).map((h) => [
        h.seq,
        h.kind,
        h.actorType,
      ]),
      [
        [2, 'origin', 'device'],
        [1, 'origin', 'device'],
      ],
    );

    const old = (await api.get(`/api/sessions/${id}/revisions/1`, owner)).json();
    assert.deepEqual(old.tags, ['nest', 'mcp']);
    assert.equal(old.markdown, '## 한 일\n\n처음\n');
    assert.equal((await api.get(`/api/sessions/${id}/revisions/9`, owner)).status, 404);
    assert.equal(
      (await api.get('/api/sessions/0192d2a0-0000-7000-8000-000000000999', owner)).status,
      404,
    );
    assert.equal((await api.get('/api/sessions/not-a-uuid', owner)).status, 400);
    assert.equal((await api.get(`/api/sessions/${id}`)).status, 403);
  });
});
