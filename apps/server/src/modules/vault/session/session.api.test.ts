import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 세션 저장 (M1 C). AI 도구가 MCP save_session으로 올리고, 주인이 관리 화면(api/sessions)에서 본다.
// M1 끝 기준: 같은 세션을 50번 동시에 저장하면 판 50개, 유실 0.
// 저장한 세션은 AI 도구가 search_sessions · get_session으로 다시 읽는다. read_public은 공개 세션만 본다.

/** read_public이나 read_all로 열리는 도구들 */
const READ_TOOLS = ['search_sessions', 'get_session', 'search_wikis', 'get_wiki', 'neighbors'];

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

/** 이 토큰으로 보이는 도구 이름들 */
async function toolNames(token: string): Promise<string[]> {
  const list = (await api.mcp(token, 'tools/list')).json().result as { tools: { name: string }[] };
  return list.tools.map((t) => t.name);
}

/** 읽기 도구 한 번. AI 도구가 받는 결과(성공이면 structuredContent, 실패면 오류 JSON) */
async function read(token: string, name: string, args: Record<string, unknown>) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
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

/** search_sessions 한 번: [찾은 세션들, next] */
async function search(token: string, args: Record<string, unknown>) {
  const res = await read(token, 'search_sessions', args);
  assert.equal(res.ok, true, JSON.stringify(res.body));
  const hits = res.body.sessions as {
    session_id: string;
    title: string;
    project: string | null;
    tool: string;
    date: string;
    excerpt: string;
  }[];
  return [hits, res.body.next as string | null] as const;
}

/** 저장한 세션 하나의 id */
async function saved(token: string, args: Record<string, unknown>): Promise<string> {
  const res = await save(token, args);
  assert.equal(res.ok, true, JSON.stringify(res.body));
  return String(res.body.session_id);
}

/** 권한을 정해 둔 기기 하나의 토큰 */
async function deviceWith(name: string, scopes: string[]): Promise<string> {
  const token = await api.connectDevice(owner, name);
  const devices = (await api.get('/api/devices', owner)).json().devices as {
    id: string;
    name: string;
    version: number;
  }[];
  const device = devices.find((d) => d.name === name);
  const changed = await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
    scopes,
    version: device?.version,
  });
  assert.equal(changed.status, 200, changed.text);
  return token;
}

/** 공개 여부를 바꾸는 화면이 아직 없어 DB에서 바로 연다 */
async function publish(id: string): Promise<void> {
  await api.service(Database)
    .sql`UPDATE vault.sessions SET visibility = 'public' WHERE node_id = ${id}`;
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
    assert.equal(first.body.url, `${site}/admin/sessions?session=${first.body.session_id}`);

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
    assert.deepEqual(await toolNames(token), READ_TOOLS);
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

describe('세션 읽기 도구 (search_sessions · get_session)', () => {
  const MISSING = '0192d2a0-0000-7000-8000-000000000999';
  let publicReader: string;
  let allReader: string;
  let uploadOnly: string;

  before(async () => {
    publicReader = await deviceWith('read-public', ['read_public']);
    allReader = await deviceWith('read-all', ['read_all']);
    uploadOnly = await deviceWith('upload-only', ['upload']);
  });

  describe('권한', () => {
    test('read_public이나 read_all 하나만 있어도 보이고, 둘 다 없으면 목록에 없고 불러도 forbidden', async () => {
      assert.deepEqual(await toolNames(publicReader), READ_TOOLS);
      assert.deepEqual(await toolNames(allReader), READ_TOOLS);
      assert.deepEqual(await toolNames(uploadOnly), [
        'check_session',
        'save_session',
        'save_transcript',
        'keep_page',
      ]);
      const denied = await Promise.all([
        read(uploadOnly, 'search_sessions', { query: '세션' }),
        read(uploadOnly, 'get_session', { session_id: MISSING }),
      ]);
      for (const res of denied)
        assert.deepEqual(
          [res.ok, res.body.code, res.body.scope],
          [false, 'forbidden', 'read_public'],
        );
    });

    test('도구는 읽기 전용으로 표시된다', async () => {
      const list = (await api.mcp(publicReader, 'tools/list')).json().result as {
        tools: { annotations: { readOnlyHint: boolean; idempotentHint: boolean } }[];
      };
      for (const tool of list.tools)
        assert.deepEqual(
          [tool.annotations.readOnlyHint, tool.annotations.idempotentHint],
          [true, true],
        );
    });
  });

  describe('search_sessions: 찾기', () => {
    test('한국어로 제목과 본문을 찾고, 낱말 일부나 한 글자도 찾는다', async () => {
      const byTitle = await saved(
        laptop,
        note('find-title', '다른 내용', { title: '돌탑쌓기 설계를 정했다' }),
      );
      const byBody = await saved(laptop, note('find-body', '오늘은 돌탑쌓기를 만들었다'));
      const [hits, next] = await search(allReader, { query: '돌탑쌓기' });
      assert.deepEqual(hits.map((h) => h.session_id).sort(), [byTitle, byBody].sort());
      assert.equal(next, null);

      const [part] = await search(allReader, { query: '탑쌓' });
      assert.equal(part.length, 2, '낱말 일부');

      const one = await saved(laptop, note('find-one', '뷁 한 글자'));
      const [single] = await search(allReader, { query: '뷁' });
      assert.deepEqual(
        single.map((h) => h.session_id),
        [one],
      );
    });

    test('찾은 줄은 짧고, 찾은 말 둘레를 보여 주며, 지금 판만 찾는다', async () => {
      const id = await saved(
        laptop,
        note('find-excerpt', `${'앞 '.repeat(500)}여기에 메아리문장이 있다 ${'뒤 '.repeat(500)}`, {
          project: 'excerpt',
          tool: 'codex',
        }),
      );
      const [[hit]] = await search(allReader, { query: '메아리문장' });
      assert.deepEqual(
        [hit?.session_id, hit?.title, hit?.project, hit?.tool],
        [id, '세션 저장 만들기', 'excerpt', 'codex'],
      );
      assert.match(hit?.excerpt ?? '', /여기에 메아리문장이 있다/);
      assert.ok((hit?.excerpt.length ?? 999) <= 160, hit?.excerpt);
      assert.doesNotMatch(hit?.excerpt ?? '', /\n/);
      assert.equal(Number.isNaN(Date.parse(hit?.date ?? '')), false);

      await save(laptop, note('find-excerpt', '바뀐 내용', { project: 'excerpt', tool: 'codex' }));
      const [old] = await search(allReader, { query: '메아리문장' });
      assert.deepEqual(old, [], '지난 판의 말로는 찾지 않는다');
    });

    test('띄어 쓴 단어는 모두 있어야 하고, 칸이 달라도 된다', async () => {
      const both = await saved(
        laptop,
        note('find-words', '구름다리를 놓았다', { decisions: '안개기둥은 뺐다' }),
      );
      await saved(laptop, note('find-word-one', '구름다리만 있다'));
      const [hits] = await search(allReader, { query: '  안개기둥   구름다리 ' });
      assert.deepEqual(
        hits.map((h) => h.session_id),
        [both],
      );
    });

    test('%·_는 그 글자 그대로 찾는다', async () => {
      const percent = await saved(laptop, note('find-percent', '달성률은 87%였다'));
      await saved(laptop, note('find-percent-no', '달성률은 87점이었다'));
      const [hits] = await search(allReader, { query: '87%' });
      assert.deepEqual(
        hits.map((h) => h.session_id),
        [percent],
      );
      assert.deepEqual((await search(allReader, { query: '달성률_' }))[0], []);
    });

    test('찾을 말이 없거나 모양이 틀리면 고칠 칸을 알려 준다', async () => {
      const res = await read(allReader, 'search_sessions', {
        query: '   ',
        limit: 31,
        from: '어제',
        cursor: 'nope',
      });
      assert.equal(res.ok, false);
      assert.deepEqual(res.body.fields, {
        query: '찾을 말을 써 주세요',
        limit: '1~30 사이여야 해요',
        from: 'ISO 8601 날짜여야 해요',
        cursor: '앞 응답의 next 값을 그대로 보내 주세요',
      });
      const missing = await read(allReader, 'search_sessions', {});
      assert.deepEqual(missing.body.fields, { query: '필수 문자열이에요' });
    });
  });

  describe('search_sessions: 거르기', () => {
    test('project·tool·from·to', async () => {
      const db = api.service(Database).sql;
      const jan = await saved(laptop, note('find-jan', '철새지도 1월', { project: 'birds' }));
      const feb = await saved(
        laptop,
        note('find-feb', '철새지도 2월', { project: 'birds', tool: 'codex' }),
      );
      const mar = await saved(laptop, note('find-mar', '철새지도 3월', { project: 'fish' }));
      await db`UPDATE vault.sessions SET last_revision_at = '2026-01-15T00:00:00Z' WHERE node_id = ${jan}`;
      await db`UPDATE vault.sessions SET last_revision_at = '2026-02-15T00:00:00Z' WHERE node_id = ${feb}`;
      await db`UPDATE vault.sessions SET last_revision_at = '2026-03-15T00:00:00Z' WHERE node_id = ${mar}`;

      const found = async (args: Record<string, unknown>) =>
        (await search(allReader, { query: '철새지도', ...args }))[0]
          .map((h) => h.session_id)
          .sort();

      assert.deepEqual(await found({}), [jan, feb, mar].sort());
      assert.deepEqual(await found({ project: 'birds' }), [jan, feb].sort());
      assert.deepEqual(await found({ tool: 'codex' }), [feb]);
      assert.deepEqual(await found({ project: 'birds', tool: 'claude-code' }), [jan]);
      assert.deepEqual(
        await found({ from: '2026-02-15T00:00:00Z' }),
        [feb, mar].sort(),
        '경계 포함',
      );
      assert.deepEqual(await found({ to: '2026-02-15T00:00:00Z' }), [jan, feb].sort(), '경계 포함');
      assert.deepEqual(await found({ from: '2026-02-01T00:00:00Z', to: '2026-02-28T00:00:00Z' }), [
        feb,
      ]);
      assert.deepEqual(await found({ project: '없는 프로젝트' }), []);
    });
  });

  describe('search_sessions: 쪽 나누기', () => {
    test('빠지거나 겹치지 않고, 쪽을 넘기는 사이에 새 판이 쌓여도 그대로다', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 7; i++)
        ids.push(await saved(laptop, note(`find-page-${i}`, `자갈길 쪽 나누기 ${i}`)));

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const [hits, next] = await search(allReader, { query: '자갈길', limit: 3, cursor });
        assert.ok(hits.length <= 3);
        seen.push(...hits.map((h) => h.session_id));
        cursor = next;
        pages += 1;
        // 첫 쪽을 본 뒤 아직 보지 않은 세션과 이미 본 세션에 새 판을 쌓는다
        if (pages === 1) {
          await saved(laptop, note('find-page-0', '자갈길 쪽 나누기 0, 새 판'));
          await saved(laptop, note('find-page-6', '자갈길 쪽 나누기 6, 새 판'));
        }
      } while (cursor !== null);

      assert.equal(pages, 3);
      assert.deepEqual(seen, [...ids].sort().reverse(), '최근에 처음 저장한 세션부터 하나씩');
    });

    test('쪽이 정확히 찰 때는 next가 없고, 기본은 10개', async () => {
      for (let i = 0; i < 11; i++) await saved(laptop, note(`find-full-${i}`, `징검다리 ${i}`));
      const [first, next] = await search(allReader, { query: '징검다리' });
      assert.equal(first.length, 10);
      assert.equal(typeof next, 'string');
      const [rest, end] = await search(allReader, { query: '징검다리', cursor: next });
      assert.equal(rest.length, 1);
      assert.equal(end, null);
      const [all, none] = await search(allReader, { query: '징검다리', limit: 11 });
      assert.equal(all.length, 11);
      assert.equal(none, null);
    });
  });

  describe('공개 범위', () => {
    test('read_public은 비공개 세션을 결과·본문 조각·next 어디서도 보지 못한다', async () => {
      const open: string[] = [];
      for (let i = 0; i < 2; i++) {
        const id = await saved(
          laptop,
          note(`find-open-${i}`, `등대불빛 공개 ${i}`, { project: 'lighthouse' }),
        );
        await publish(id);
        open.push(id);
      }
      const hidden: string[] = [];
      for (let i = 0; i < 3; i++)
        hidden.push(
          await saved(
            laptop,
            note(`find-hidden-${i}`, `등대불빛 비밀메모 ${i}`, {
              project: 'lighthouse',
              title: '비밀제목',
            }),
          ),
        );

      // 비공개 세션이 더 있어도 공개 세션만으로 쪽을 나눈다: 딱 찬 쪽 뒤에 next가 없다
      const [hits, next] = await search(publicReader, { query: '등대불빛', limit: 2 });
      assert.deepEqual(hits.map((h) => h.session_id).sort(), [...open].sort());
      assert.equal(next, null);
      const raw = (
        await api.mcp(publicReader, 'tools/call', {
          name: 'search_sessions',
          arguments: { query: '등대불빛', limit: 30 },
        })
      ).text;
      assert.equal(raw.includes('비밀'), false);
      for (const id of hidden) assert.equal(raw.includes(id), false);

      // 전부 볼 수 있는 기기에는 다섯 다 보인다
      const [everything] = await search(allReader, { query: '등대불빛', limit: 30 });
      assert.equal(everything.length, 5);
      const [partial, more] = await search(allReader, { query: '등대불빛', limit: 2 });
      assert.equal(partial.length, 2);
      assert.equal(typeof more, 'string');
    });

    test('비공개에만 있는 말·프로젝트는 없는 말과 똑같이 빈 결과. 비공개 세션을 커서로 줘도 공개 세션만 나온다', async () => {
      const open = await saved(laptop, note('find-gap-open', '나룻배 공개', { project: 'ferry' }));
      await publish(open);
      const hidden = await saved(
        laptop,
        note('find-gap-hidden', '나룻배 뱃사공비밀', { project: 'ferry-secret' }),
      );

      const nothing = await read(publicReader, 'search_sessions', { query: '있을수없는말' });
      assert.deepEqual(
        (await read(publicReader, 'search_sessions', { query: '뱃사공비밀' })).body,
        nothing.body,
      );
      assert.deepEqual(
        (await read(publicReader, 'search_sessions', { query: '나룻배', project: 'ferry-secret' }))
          .body,
        nothing.body,
      );

      // 커서는 자리일 뿐이다: 비공개 세션을 가리켜도 없는 id와 똑같이 그보다 앞선 공개 세션만 나온다
      const from = (id: string) =>
        search(publicReader, { query: '나룻배', cursor: Buffer.from(id).toString('base64url') });
      const [hits, end] = await from(hidden);
      assert.deepEqual(
        hits.map((h) => h.session_id),
        [open],
      );
      assert.equal(end, null);
      assert.deepEqual(await from('ffffffff-ffff-7fff-bfff-ffffffffffff'), [hits, end]);
    });

    test('휴지통의 세션은 찾지도 읽지도 못한다', async () => {
      const id = await saved(laptop, note('find-trash', '풍경소리 휴지통'));
      await api.service(Database).sql`UPDATE vault.nodes SET deleted_at = now() WHERE id = ${id}`;
      assert.deepEqual((await search(allReader, { query: '풍경소리' }))[0], []);
      assert.deepEqual(
        (await read(allReader, 'get_session', { session_id: id })).body,
        (await read(allReader, 'get_session', { session_id: MISSING })).body,
      );
    });
  });

  describe('get_session', () => {
    test('지금 판의 제목·프로젝트·도구·시각·태그·내용 있는 칸', async () => {
      const id = await saved(
        laptop,
        note('read-one', '처음', {
          tags: ['검색', 'mcp'],
          started_at: '2026-10-01T09:00:00.000Z',
        }),
      );
      await save(
        laptop,
        note('read-one', '고친 뒤', { decisions: '판은 추가만', tags: ['검색', 'mcp'] }),
      );
      const res = await read(allReader, 'get_session', { session_id: id });
      assert.equal(res.ok, true, JSON.stringify(res.body));
      const { last_revision_at: last, ...rest } = res.body;
      assert.equal(Number.isNaN(Date.parse(String(last))), false);
      assert.deepEqual(rest, {
        session_id: id,
        title: '세션 저장 만들기',
        project: 'cairn',
        tool: 'claude-code',
        started_at: '2026-10-01T09:00:00.000Z',
        revision: 2,
        tags: ['검색', 'mcp'],
        sections: { did: '고친 뒤', decisions: '판은 추가만' },
      });
    });

    test('비공개 세션은 read_public에게 없는 세션과 똑같고, read_all에게는 보인다', async () => {
      const hidden = await saved(laptop, note('read-hidden', '비공개 내용'));
      const open = await saved(laptop, note('read-open', '공개 내용'));
      await publish(open);

      const privately = await read(publicReader, 'get_session', { session_id: hidden });
      const missing = await read(publicReader, 'get_session', { session_id: MISSING });
      assert.deepEqual(privately, missing);
      assert.deepEqual([privately.ok, privately.body.code], [false, 'not_found']);

      const visible = await read(publicReader, 'get_session', { session_id: open });
      assert.deepEqual(visible.body.sections, { did: '공개 내용' });
      const all = await read(allReader, 'get_session', { session_id: hidden });
      assert.deepEqual(all.body.sections, { did: '비공개 내용' });
    });

    test('틀린 id는 고칠 칸을 알려 준다', async () => {
      const res = await read(publicReader, 'get_session', { session_id: 'not-a-uuid' });
      assert.deepEqual(res.body.fields, { session_id: 'UUID 형식이어야 해요' });
    });
  });

  test('지운 비밀값은 찾은 줄에도 읽은 칸에도 없고, 그 값으로 찾을 수도 없다', async () => {
    const secret = `gh${'p_'}${'Q7w8E9r0'.repeat(5)}`;
    const id = await saved(
      laptop,
      note('find-secret', `풀무질 토큰 ${secret} 으로 푸시했다`, {
        title: `풀무질 ${secret}`,
      }),
    );
    await publish(id);

    for (const reader of [publicReader, allReader]) {
      const [[hit]] = await search(reader, { query: '풀무질' });
      assert.equal(hit?.session_id, id);
      assert.equal(JSON.stringify(hit).includes(secret), false);
      assert.match(hit?.title ?? '', /\[지움: GitHub 토큰\]/);
      assert.match(hit?.excerpt ?? '', /\[지움: GitHub 토큰\]/);

      const res = await read(reader, 'get_session', { session_id: id });
      assert.equal(JSON.stringify(res.body).includes(secret), false);
      assert.match(JSON.stringify(res.body), /\[지움: GitHub 토큰\]/);

      assert.deepEqual((await search(reader, { query: secret }))[0], []);
    }
  });
});
