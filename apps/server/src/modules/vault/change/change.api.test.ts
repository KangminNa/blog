import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OwnerActor } from '../../platform';
import { WikiBody } from '../wiki/wiki-body';
import { EditInput } from './change.input';
import { ChangeService } from './change.service';
import { EdgeAddOp, EdgeRemoveOp, SessionAssignOp, WikiReviseOp } from './change-op';

// 변경 묶음: AI는 submit_changes로 내고, 주인은 REST로 검토하고 되돌린다.
// 연결선과 세션의 사람 표시는 관리 화면 경로가 아직 없어 ChangeService.edit을 바로 부른다.

type Json = Record<string, unknown>;
type OpResult = { seq: number; verdict: string; status: string; reason: string | null };

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** tidy · read_all · upload 권한을 준 기기 */
let tidy: string;
/** run 권한을 준 기기 (러너) */
let runner: string;
/** 기본 권한만 있는 기기 */
let laptop: string;
let ownerActor: OwnerActor;

async function tool(
  token: string,
  name: string,
  args: Json = {},
): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, body: result.structuredContent ?? {} };
}

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** submit_changes 한 번. 호출이 성공해야 하는 경우 */
async function submit(
  ops: Json[],
  token = tidy,
  requestId: string = randomUUID(),
): Promise<{ id: string; ops: OpResult[] }> {
  const { ok: done, body } = await tool(token, 'submit_changes', {
    request_id: requestId,
    message: '정리',
    ops,
  });
  assert.equal(done, true, JSON.stringify(body));
  return { id: String(body.change_set_id), ops: body.ops as OpResult[] };
}

/** AI가 wiki를 하나 만든다 */
async function aiWiki(title: string, bodyMd: string): Promise<string> {
  const set = await submit([{ op: 'wiki.create', payload: { title, body_md: bodyMd } }]);
  assert.equal(set.ops[0]?.status, 'applied');
  const [row] = await db.sql`
    SELECT target_id FROM vault.change_ops WHERE change_set_id = ${set.id} AND seq = 1`;
  return String(row?.target_id);
}

const getWiki = (id: string): Promise<Json> =>
  api.get(`/api/wikis/${id}`, owner).then((r) => ok(r));

/** 세션을 하나 올린다. 돌려주는 값은 세션 id */
async function aSession(): Promise<string> {
  const { body } = await tool(tidy, 'save_session', {
    request_id: randomUUID(),
    source_session_id: `conv-${randomUUID()}`,
    tool: 'claude-code',
    title: '세션',
    did: '한 일',
  });
  return String(body.session_id);
}

async function sessionRow(id: string) {
  const [row] = await db.sql`SELECT wiki_id, version FROM vault.sessions WHERE node_id = ${id}`;
  return { wikiId: row?.wiki_id as string | null, version: Number(row?.version) };
}

async function setVersion(id: string): Promise<number> {
  const [row] = await db.sql`SELECT version FROM vault.change_sets WHERE id = ${id}`;
  return Number(row?.version);
}

const decide = async (id: string, seq: number, decision: string, version?: number) =>
  api.request('POST', `/api/changes/${id}/ops/${seq}/decide`, owner, {
    version: version ?? (await setVersion(id)),
    decision,
  });

const revert = async (id: string, version?: number) =>
  api.request('POST', `/api/changes/${id}/revert`, owner, {
    version: version ?? (await setVersion(id)),
  });

function edit(...ops: EditInput['ops']) {
  return api.service(ChangeService).edit(ownerActor, new EditInput(null, '사람', ops));
}

/** 러너가 일을 하나 빌려 tidy 권한의 작업 토큰을 받는다 */
async function runToken(): Promise<{ token: string; taskId: string }> {
  const queued = ok(await api.get('/api/tasks?status=queued', owner)) as {
    tasks: { id: string; version: number }[];
  };
  for (const t of queued.tasks)
    ok(await api.request('POST', `/api/tasks/${t.id}/cancel`, owner, { version: t.version }));
  const agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '정리',
      tool: 'claude',
      scopes: ['tidy', 'read_all'],
    }),
    201,
  );
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      kind: 'tidy_session',
      title: '정리',
      instruction: '세션을 정리해 주세요',
    }),
    201,
  );
  const { body } = await tool(runner, 'next_jobs');
  const jobs = body.jobs as { task: { id: string }; run_token: string }[];
  assert.equal(jobs.length, 1, JSON.stringify(body));
  assert.equal(jobs[0]?.task.id, task.id);
  return { token: String(jobs[0]?.run_token), taskId: String(task.id) };
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  tidy = await api.connectDevice(owner, 'change-tidy');
  runner = await api.connectDevice(owner, 'change-runner');
  laptop = await api.connectDevice(owner, 'change-laptop');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const grant = async (name: string, scopes: string[]) => {
    const device = devices.find((d) => d.name === name);
    ok(
      await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
        scopes,
        version: device?.version,
      }),
    );
  };
  await grant('change-tidy', ['upload', 'read_all', 'tidy']);
  await grant('change-runner', ['run']);
  // 주인의 공간과 id는 주인이 남긴 묶음에서 읽는다 (vault는 account를 모른다)
  const made = ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: `주인 ${randomUUID()}`,
    }),
    201,
  );
  const [set] = await db.sql`
    SELECT space_id, actor_id FROM vault.change_sets WHERE id = ${String(made.changeSetId)}`;
  ownerActor = new OwnerActor(String(set?.space_id), String(set?.actor_id));
});
after(() => api.close());

describe('권한', () => {
  test('tidy 권한이 없으면 도구가 보이지 않고 불러도 forbidden', async () => {
    const list = (await api.mcp(laptop, 'tools/list')).json().result as {
      tools: { name: string }[];
    };
    assert.equal(
      list.tools.some((t) => t.name === 'submit_changes'),
      false,
    );
    const { ok: done, body } = await tool(laptop, 'submit_changes', {
      request_id: randomUUID(),
      message: '정리',
      ops: [{ op: 'wiki.create', payload: { title: '제목', body_md: '본문' } }],
    });
    assert.deepEqual([done, body.scope], [false, 'tidy']);
  });

  test('승인함과 결정·되돌리기는 주인만', async () => {
    const id = randomUUID();
    assert.equal((await api.get('/api/changes')).status, 403);
    assert.equal(
      (await api.request('POST', `/api/changes/${id}/revert`, TestUser.visitor, { version: 1 }))
        .status,
      403,
    );
    assert.equal(
      (
        await api.request('POST', `/api/changes/${id}/ops/1/decide`, TestUser.visitor, {
          version: 1,
          decision: 'approve',
        })
      ).status,
      403,
    );
  });
});

describe('submit_changes', () => {
  test('모르는 변경이나 틀린 모양은 호출 전체가 실패하고 아무것도 남지 않는다', async () => {
    const message = `틀린 묶음 ${randomUUID()}`;
    const { ok: done, body } = await tool(tidy, 'submit_changes', {
      request_id: randomUUID(),
      message,
      ops: [
        { op: 'wiki.create', payload: { title: '제목', body_md: '본문' } },
        { op: 'category.delete', target_id: randomUUID(), payload: {} },
        { op: 'wiki.revise', payload: { body_md: '본문' } },
        { op: 'session.assign', target_id: randomUUID(), payload: { wiki_id: 'x' } },
      ],
    });
    assert.equal(done, false);
    assert.equal(body.code, 'invalid_request');
    assert.deepEqual(Object.keys(body.fields as Json).sort(), [
      'ops.1.op',
      'ops.2.target_id',
      'ops.3.payload.wiki_id',
    ]);
    const rows = await db.sql`SELECT 1 FROM vault.change_sets WHERE message = ${message}`;
    assert.equal(rows.length, 0);
  });

  test('비어 있는 묶음은 받지 않는다', async () => {
    const { body } = await tool(tidy, 'submit_changes', {
      request_id: randomUUID(),
      message: '정리',
      ops: [],
    });
    assert.equal(body.code, 'invalid_request');
  });

  test('새 wiki는 비공개로 합쳐지고 묶음과 판이 남는다', async () => {
    const title = `새 wiki ${randomUUID()}`;
    const set = await submit([{ op: 'wiki.create', payload: { title, body_md: '## 배경\n\n첫' } }]);
    assert.deepEqual(set.ops, [{ seq: 1, verdict: 'merge', status: 'applied', reason: null }]);
    const [row] = await db.sql`
      SELECT s.kind, s.status, s.actor_type, s.job_id, s.closed_at, o.target_id, o.target_kind
      FROM vault.change_sets s JOIN vault.change_ops o ON o.change_set_id = s.id
      WHERE s.id = ${set.id}`;
    assert.deepEqual([row?.kind, row?.status, row?.actor_type], ['tidy', 'done', 'device']);
    assert.equal(row?.job_id, null);
    assert.notEqual(row?.closed_at, null);
    const wiki = await getWiki(String(row?.target_id));
    assert.deepEqual(
      [wiki.visibility, wiki.origin, wiki.revisionCount, wiki.bodyMd],
      ['private', 'ai', 1, '## 배경\n\n첫'],
    );
    const [revision] = await db.sql`
      SELECT change_set_id, kind, actor_type FROM vault.wiki_revisions WHERE wiki_id = ${row?.target_id}`;
    assert.deepEqual(
      [revision?.change_set_id, revision?.kind, revision?.actor_type],
      [set.id, 'ai', 'device'],
    );
  });

  test('거부나 검토가 있어도 호출은 성공하고 변경마다 알려 준다', async () => {
    const session = await aSession();
    const set = await submit([
      { op: 'wiki.create', payload: { title: `섞인 묶음 ${randomUUID()}`, body_md: '본문' } },
      { op: 'session.assign', target_id: session, payload: { wiki_id: randomUUID() } },
      { op: 'category.create', payload: { name: `구역 ${randomUUID()}` } },
    ]);
    assert.deepEqual(
      set.ops.map((o) => [o.seq, o.verdict, o.status]),
      [
        [1, 'merge', 'applied'],
        [2, 'reject', 'rejected'],
        [3, 'review', 'waiting'],
      ],
    );
    assert.match(String(set.ops[1]?.reason), /찾을 수 없어요/);
    const [row] = await db.sql`SELECT status FROM vault.change_sets WHERE id = ${set.id}`;
    assert.equal(row?.status, 'review');
  });

  test('AI가 공개 여부를 정하려 하면 그 변경만 거부된다', async () => {
    const set = await submit([
      {
        op: 'wiki.create',
        payload: { title: `공개 ${randomUUID()}`, body_md: '본문', visibility: 'public' },
      },
    ]);
    assert.deepEqual([set.ops[0]?.verdict, set.ops[0]?.status], ['reject', 'rejected']);
    assert.match(String(set.ops[0]?.reason), /공개 여부/);
  });

  test('@번호로 앞 변경이 만든 wiki를 가리킨다. 합쳐지지 않은 변경을 가리키면 거부', async () => {
    const session = await aSession();
    const wiki = await aiWiki(`이웃 ${randomUUID()}`, '본문');
    const set = await submit([
      { op: 'wiki.create', payload: { title: `연결 ${randomUUID()}`, body_md: '본문' } },
      { op: 'session.assign', target_id: session, payload: { wiki_id: '@1' } },
      { op: 'edge.add', payload: { src: '@1', dst: wiki, kind: 'link' } },
      { op: 'category.create', payload: { name: `구역 ${randomUUID()}` } },
      { op: 'category.assign', target_id: wiki, payload: { category_id: '@4' } },
    ]);
    assert.deepEqual(
      set.ops.map((o) => o.status),
      ['applied', 'applied', 'applied', 'waiting', 'rejected'],
    );
    const [made] = await db.sql`
      SELECT target_id FROM vault.change_ops WHERE change_set_id = ${set.id} AND seq = 1`;
    assert.equal((await sessionRow(session)).wikiId, made?.target_id);
    const edges = await db.sql`
      SELECT origin, pinned FROM vault.edges
      WHERE kind = 'link' AND (src = ${String(made?.target_id)} OR dst = ${String(made?.target_id)})`;
    assert.deepEqual(
      edges.map((e) => [e.origin, e.pinned]),
      [['ai', false]],
    );
  });

  test('wiki에 넣은 비밀값은 판이 되기 전에 지운다', async () => {
    const secret = `gh${'p_'}${'A1b2C3d4'.repeat(5)}`;
    const id = await aiWiki(`비밀 ${randomUUID()}`, `토큰 ${secret} 로 확인`);
    const wiki = await getWiki(id);
    assert.equal(String(wiki.bodyMd).includes(secret), false);
    assert.match(String(wiki.bodyMd), /\[지움: GitHub 토큰\]/);
  });

  test('같은 request_id는 한 번만 적용한다', async () => {
    const requestId = randomUUID();
    const title = `한 번만 ${randomUUID()}`;
    const ops = [{ op: 'wiki.create', payload: { title, body_md: '본문' } }];
    const [first, second] = await Promise.all([
      submit(ops, tidy, requestId),
      submit(ops, tidy, requestId),
    ]);
    assert.equal(first?.id, second?.id);
    assert.deepEqual(first?.ops, second?.ops);
    assert.equal((await db.sql`SELECT 1 FROM vault.wikis WHERE title = ${title}`).length, 1);
  });

  test('다른 도구에 쓴 request_id면 409로 멈춘다', async () => {
    const requestId = randomUUID();
    await tool(tidy, 'save_session', {
      request_id: requestId,
      source_session_id: `conv-${randomUUID()}`,
      tool: 'claude-code',
      title: '세션',
      did: '한 일',
    });
    const { body } = await tool(tidy, 'submit_changes', {
      request_id: requestId,
      message: '정리',
      ops: [{ op: 'wiki.create', payload: { title: '제목', body_md: '본문' } }],
    });
    assert.equal(body.code, 'conflict');
  });

  describe('작업 토큰', () => {
    test('같은 작업의 두 번째 제출은 첫 결과를 돌려주고 두 번 적용하지 않는다', async () => {
      const { token, taskId } = await runToken();
      const title = `작업 ${randomUUID()}`;
      const ops = [{ op: 'wiki.create', payload: { title, body_md: '본문' } }];
      const first = await submit(ops, token);
      const second = await submit(
        [{ op: 'wiki.create', payload: { title: `${title} 다른 내용`, body_md: '본문' } }],
        token,
      );
      assert.equal(second.id, first.id);
      assert.deepEqual(second.ops, first.ops);
      const titles = await db.sql`SELECT title FROM vault.wikis WHERE title LIKE ${`${title}%`}`;
      assert.deepEqual(
        titles.map((t) => t.title),
        [title],
      );
      const [row] = await db.sql`
        SELECT job_id, actor_type FROM vault.change_sets WHERE id = ${first.id}`;
      assert.deepEqual([row?.job_id, row?.actor_type], [taskId, 'ai']);
    });

    test('동시에 내도 묶음은 하나다', async () => {
      const { token, taskId } = await runToken();
      const title = `동시 ${randomUUID()}`;
      const results = await Promise.all(
        [1, 2, 3].map((n) =>
          submit(
            [{ op: 'wiki.create', payload: { title: `${title} ${n}`, body_md: '본문' } }],
            token,
          ),
        ),
      );
      assert.equal(new Set(results.map((r) => r.id)).size, 1);
      const sets = await db.sql`SELECT 1 FROM vault.change_sets WHERE job_id = ${taskId}`;
      assert.equal(sets.length, 1);
    });

    test('도구는 작업을 끝내지 않는다 (러너의 submit_result가 끝낸다)', async () => {
      const { token, taskId } = await runToken();
      await submit(
        [{ op: 'wiki.create', payload: { title: `끝 ${randomUUID()}`, body_md: '본문' } }],
        token,
      );
      const task = ok(await api.get(`/api/tasks/${taskId}`, owner));
      assert.equal(task.status, 'running');
    });
  });
});

describe('검토', () => {
  /** 승인함에서 이 묶음의 변경을 찾는다 */
  async function inbox(setId: string): Promise<Json | undefined> {
    const { changes } = ok(await api.get('/api/changes?status=waiting', owner)) as {
      changes: Json[];
    };
    return changes.find((c) => c.setId === setId);
  }

  test('사람이 고친 칸을 바꾸는 AI 변경은 승인함에 가고, 승인하면 적용된다', async () => {
    const id = await aiWiki(`검토 ${randomUUID()}`, '## 배경\n\nAI\n\n## 결론\n\nAI');
    const wiki = await getWiki(id);
    const saved = ok(
      await api.request('PUT', `/api/wikis/${id}`, owner, {
        version: wiki.version,
        title: wiki.title,
        bodyMd: '## 배경\n\n사람\n\n## 결론\n\nAI',
      }),
    );
    assert.deepEqual(saved.pinnedSections, ['배경']);
    const set = await submit([
      {
        op: 'wiki.revise',
        target_id: id,
        base_version: saved.version,
        payload: { body_md: '## 배경\n\nAI가 덮음\n\n## 결론\n\nAI' },
      },
    ]);
    assert.deepEqual([set.ops[0]?.verdict, set.ops[0]?.status], ['review', 'waiting']);
    assert.equal((await getWiki(id)).bodyMd, '## 배경\n\n사람\n\n## 결론\n\nAI');

    const item = await inbox(set.id);
    assert.equal(item?.op, 'wiki.revise');
    assert.equal(item?.rule, 'human_owned');
    assert.deepEqual(item?.target, { kind: 'wiki', id, version: saved.version });
    assert.deepEqual(
      (item?.payload as Json | undefined)?.body_md,
      '## 배경\n\nAI가 덮음\n\n## 결론\n\nAI',
    );

    const done = ok(await decide(set.id, 1, 'approve', Number(item?.version)));
    assert.equal(done.status, 'done');
    assert.equal((done.ops as OpResult[])[0]?.status, 'applied');
    const after = await getWiki(id);
    assert.equal(after.bodyMd, '## 배경\n\nAI가 덮음\n\n## 결론\n\nAI');
    assert.deepEqual(after.pinnedSections, ['배경']);
    assert.equal(await inbox(set.id), undefined);
    const [row] = await db.sql`
      SELECT decided_by, decided_at FROM vault.change_ops WHERE change_set_id = ${set.id}`;
    assert.equal(row?.decided_by, ownerActor.id);
    assert.notEqual(row?.decided_at, null);
  });

  test('거절하면 아무것도 바뀌지 않는다', async () => {
    const name = `거절 ${randomUUID()}`;
    const set = await submit([{ op: 'category.create', payload: { name } }]);
    const done = ok(await decide(set.id, 1, 'decline'));
    assert.deepEqual([done.status, (done.ops as OpResult[])[0]?.status], ['done', 'declined']);
    assert.equal((await db.sql`SELECT 1 FROM vault.categories WHERE name = ${name}`).length, 0);
  });

  test('카테고리 만들기와 옮기기는 승인해야 적용된다', async () => {
    const id = await aiWiki(`구조 ${randomUUID()}`, '본문');
    const name = `승인 구역 ${randomUUID()}`;
    const created = await submit([{ op: 'category.create', payload: { name } }]);
    assert.equal(created.ops[0]?.status, 'waiting');
    ok(await decide(created.id, 1, 'approve'));
    const [category] = await db.sql`
      SELECT node_id, origin FROM vault.categories WHERE name = ${name}`;
    assert.equal(category?.origin, 'ai');
    const assign = await submit([
      { op: 'category.assign', target_id: id, payload: { category_id: category?.node_id } },
    ]);
    assert.equal(assign.ops[0]?.status, 'waiting');
    assert.equal((await getWiki(id)).categoryId, null);
    ok(await decide(assign.id, 1, 'approve'));
    assert.equal((await getWiki(id)).categoryId, category?.node_id);
  });

  test('판정한 뒤 대상이 바뀌었으면 승인해도 밀려나고 최신 내용은 그대로다', async () => {
    const id = await aiWiki(`밀려남 ${randomUUID()}`, '## 배경\n\nAI');
    const first = await getWiki(id);
    const pinned = ok(
      await api.request('PUT', `/api/wikis/${id}`, owner, {
        version: first.version,
        title: first.title,
        bodyMd: '## 배경\n\n사람',
      }),
    );
    const set = await submit([
      {
        op: 'wiki.revise',
        target_id: id,
        base_version: pinned.version,
        payload: { body_md: '## 배경\n\nAI가 덮음' },
      },
    ]);
    assert.equal(set.ops[0]?.status, 'waiting');
    ok(
      await api.request('PUT', `/api/wikis/${id}`, owner, {
        version: pinned.version,
        title: first.title,
        bodyMd: '## 배경\n\n사람이 더 고침',
      }),
    );
    const done = ok(await decide(set.id, 1, 'approve'));
    assert.equal(done.status, 'done');
    assert.equal((done.ops as OpResult[])[0]?.status, 'superseded');
    assert.equal((await getWiki(id)).bodyMd, '## 배경\n\n사람이 더 고침');
  });

  test('AI가 본 뒤에 바뀐 대상은 제안으로 가고, 그 뒤로 더 바뀌지 않으면 승인할 수 있다', async () => {
    const id = await aiWiki(`늦은 쪽 ${randomUUID()}`, '본문');
    const seen = await getWiki(id);
    await submit([
      {
        op: 'wiki.revise',
        target_id: id,
        base_version: seen.version,
        payload: { body_md: '먼저 온 결과' },
      },
    ]);
    const late = await submit([
      {
        op: 'wiki.revise',
        target_id: id,
        base_version: seen.version,
        payload: { body_md: '늦은 결과' },
      },
    ]);
    assert.deepEqual([late.ops[0]?.verdict, late.ops[0]?.status], ['review', 'waiting']);
    assert.equal((await getWiki(id)).bodyMd, '먼저 온 결과');
    ok(await decide(late.id, 1, 'approve'));
    assert.equal((await getWiki(id)).bodyMd, '늦은 결과');
  });

  test('한 묶음에서 같은 대상을 차례로 바꿔도 앞 변경 때문에 밀리지 않는다', async () => {
    const id = await aiWiki(`차례로 ${randomUUID()}`, '본문');
    const seen = await getWiki(id);
    const set = await submit([
      {
        op: 'wiki.revise',
        target_id: id,
        base_version: seen.version,
        payload: { body_md: '하나' },
      },
      {
        op: 'wiki.revise',
        target_id: id,
        base_version: seen.version,
        payload: { body_md: '둘' },
      },
    ]);
    assert.deepEqual(
      set.ops.map((o) => o.status),
      ['applied', 'applied'],
    );
    assert.equal((await getWiki(id)).revisionCount, 3);
  });

  test('version이 어긋나거나 이미 처리했으면 409', async () => {
    const set = await submit([
      { op: 'category.create', payload: { name: `겹침 ${randomUUID()}` } },
    ]);
    assert.equal((await decide(set.id, 1, 'approve', 99)).status, 409);
    ok(await decide(set.id, 1, 'decline'));
    assert.equal((await decide(set.id, 1, 'approve')).status, 409);
  });

  test('없는 묶음이나 없는 변경은 404, 모르는 결정은 400', async () => {
    const set = await submit([
      { op: 'category.create', payload: { name: `없음 ${randomUUID()}` } },
    ]);
    assert.equal((await decide(randomUUID(), 1, 'approve', 1)).status, 404);
    assert.equal((await decide(set.id, 9, 'approve')).status, 404);
    assert.equal((await decide(set.id, 1, 'maybe')).status, 400);
  });

  test('승인함은 커서로 넘긴다', async () => {
    const ops = Array.from({ length: 31 }, () => ({
      op: 'category.create',
      payload: { name: `쪽 ${randomUUID()}` },
    }));
    const set = await submit(ops);
    const seen: Json[] = [];
    let cursor: unknown = null;
    do {
      const path = cursor ? `/api/changes?cursor=${cursor}` : '/api/changes';
      const page = ok(await api.get(path, owner)) as { changes: Json[]; next: string | null };
      seen.push(...page.changes.filter((c) => c.setId === set.id));
      cursor = page.next;
    } while (cursor);
    assert.deepEqual(
      seen.map((c) => c.seq),
      Array.from({ length: 31 }, (_, i) => i + 1),
    );
    assert.equal((await api.get('/api/changes?status=done', owner)).status, 400);
    assert.equal((await api.get('/api/changes?cursor=!!', owner)).status, 400);
    // 다음 테스트의 승인함이 깔끔하도록 묶음을 닫는다
    for (let seq = 1; seq <= 31; seq++) ok(await decide(set.id, seq, 'decline'));
  });
});

describe('규칙 값', () => {
  test('주인이 고른 값(review_rules)을 읽는다', async () => {
    await db.sql`
      INSERT INTO vault.review_rules (space_id, key, action)
      VALUES (${String(ownerActor.spaceId)}, 'add', 'review')`;
    try {
      const set = await submit([
        { op: 'wiki.create', payload: { title: `규칙 ${randomUUID()}`, body_md: '본문' } },
      ]);
      assert.deepEqual([set.ops[0]?.verdict, set.ops[0]?.status], ['review', 'waiting']);
      ok(await decide(set.id, 1, 'decline'));
    } finally {
      await db.sql`DELETE FROM vault.review_rules WHERE key = 'add'`;
    }
  });

  test('대상이 50개인 묶음은 전부 검토로 가고, 49개는 바로 합친다', async () => {
    const wikis = (n: number) =>
      Array.from({ length: n }, () => ({
        op: 'wiki.create',
        payload: { title: `큰 묶음 ${randomUUID()}`, body_md: '본문' },
      }));
    const small = await submit(wikis(49));
    assert.ok(small.ops.every((o) => o.status === 'applied'));
    const large = await submit(wikis(50));
    assert.ok(large.ops.every((o) => o.verdict === 'review' && o.status === 'waiting'));
    for (const op of large.ops) ok(await decide(large.id, op.seq, 'decline'));
  });
});

describe('세션의 대표 wiki', () => {
  test('비어 있으면 합치고, 사람이 정했으면 검토로 간다', async () => {
    const session = await aSession();
    const first = await aiWiki(`대표 ${randomUUID()}`, '본문');
    const second = await aiWiki(`대표 ${randomUUID()}`, '본문');
    const empty = await submit([
      { op: 'session.assign', target_id: session, payload: { wiki_id: first } },
    ]);
    assert.deepEqual([empty.ops[0]?.verdict, empty.ops[0]?.status], ['merge', 'applied']);
    assert.equal((await sessionRow(session)).wikiId, first);

    const { version } = await sessionRow(session);
    await edit(new SessionAssignOp(1, session, version, second));
    const third = await aiWiki(`대표 ${randomUUID()}`, '본문');
    const human = await submit([
      { op: 'session.assign', target_id: session, payload: { wiki_id: third } },
    ]);
    assert.deepEqual([human.ops[0]?.verdict, human.ops[0]?.status], ['review', 'waiting']);
    assert.equal((await sessionRow(session)).wikiId, second);
  });
});

describe('연결선', () => {
  async function linkOf(a: string, b: string) {
    const [src, dst] = a < b ? [a, b] : [b, a];
    const [row] = await db.sql`
      SELECT id, origin, pinned, deleted_at, deleted_by_type FROM vault.edges
      WHERE src = ${src} AND dst = ${dst} AND kind = 'link'`;
    return row;
  }

  const link = (op: string, a: string, b: string): Json => ({
    op,
    payload: { src: a, dst: b, kind: 'link' },
  });

  test('사람이 지운 선은 행이 남고 AI가 다시 만들면 거부된다', async () => {
    const a = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const b = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const added = await submit([link('edge.add', a, b)]);
    assert.deepEqual([added.ops[0]?.verdict, added.ops[0]?.status], ['merge', 'applied']);
    assert.deepEqual([(await linkOf(a, b))?.origin, (await linkOf(a, b))?.pinned], ['ai', false]);

    await edit(new EdgeRemoveOp(1, null, a, b, 'link'));
    const removed = await linkOf(a, b);
    assert.notEqual(removed?.deleted_at, null);
    assert.equal(removed?.deleted_by_type, 'user');

    const again = await submit([link('edge.add', b, a)]);
    assert.deepEqual([again.ops[0]?.verdict, again.ops[0]?.status], ['reject', 'rejected']);
    assert.match(String(again.ops[0]?.reason), /사람이 지운/);
    assert.notEqual((await linkOf(a, b))?.deleted_at, null);
  });

  test('사람이 다시 만들면 되살아나고 사람의 선이 된다', async () => {
    const a = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const b = await aiWiki(`끝 ${randomUUID()}`, '본문');
    await edit(new EdgeAddOp(1, null, a, b, 'link', true));
    await edit(new EdgeRemoveOp(1, null, a, b, 'link'));
    await edit(new EdgeAddOp(1, null, a, b, 'link', true));
    const row = await linkOf(a, b);
    assert.deepEqual(
      [row?.origin, row?.pinned, row?.deleted_at, row?.deleted_by_type],
      ['human', true, null, null],
    );
  });

  test('사람이 만든 선을 AI가 지우려 하면 검토, 승인하면 사람이 지운 선으로 남는다', async () => {
    const a = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const b = await aiWiki(`끝 ${randomUUID()}`, '본문');
    await edit(new EdgeAddOp(1, null, a, b, 'link', true));
    const set = await submit([link('edge.remove', a, b)]);
    assert.deepEqual([set.ops[0]?.verdict, set.ops[0]?.status], ['review', 'waiting']);
    assert.equal((await linkOf(a, b))?.deleted_at, null);
    ok(await decide(set.id, 1, 'approve'));
    assert.equal((await linkOf(a, b))?.deleted_by_type, 'user');
  });

  test('AI가 만든 선은 AI가 지울 수 있고 다시 만들 수 있다', async () => {
    const a = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const b = await aiWiki(`끝 ${randomUUID()}`, '본문');
    await submit([link('edge.add', a, b)]);
    const gone = await submit([link('edge.remove', a, b)]);
    assert.equal(gone.ops[0]?.status, 'applied');
    assert.equal((await linkOf(a, b))?.deleted_by_type, 'device');
    const back = await submit([link('edge.add', a, b)]);
    assert.equal(back.ops[0]?.status, 'applied');
    assert.equal((await linkOf(a, b))?.deleted_at, null);
  });

  test('이미 있는 선을 더하면 바뀌는 것이 없다', async () => {
    const a = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const b = await aiWiki(`끝 ${randomUUID()}`, '본문');
    await submit([link('edge.add', a, b)]);
    const again = await submit([link('edge.add', a, b)]);
    assert.equal(again.ops[0]?.status, 'applied');
    const records = await db.sql`SELECT 1 FROM vault.changes WHERE batch_id = ${again.id}`;
    assert.equal(records.length, 0);
  });

  test('같은 선을 동시에 더해도 행은 하나다', async () => {
    const a = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const b = await aiWiki(`끝 ${randomUUID()}`, '본문');
    await Promise.all(Array.from({ length: 5 }, () => submit([link('edge.add', a, b)])));
    const rows = await db.sql`
      SELECT 1 FROM vault.edges
      WHERE (src = ${a} AND dst = ${b}) OR (src = ${b} AND dst = ${a})`;
    assert.equal(rows.length, 1);
  });
});

describe('되돌리기', () => {
  test('wiki.revise를 되돌리면 앞 내용이 새 판으로 쌓이고 기록은 남는다', async () => {
    const id = await aiWiki(`되돌리기 ${randomUUID()}`, '처음');
    const revised = await submit([
      { op: 'wiki.revise', target_id: id, payload: { body_md: '고침', title: '새 제목' } },
    ]);
    assert.equal((await getWiki(id)).bodyMd, '고침');

    const result = ok(await revert(revised.id));
    assert.equal(result.kind, 'revert');
    assert.equal(result.status, 'done');

    const wiki = await getWiki(id);
    assert.equal(wiki.bodyMd, '처음');
    assert.notEqual(wiki.title, '새 제목');
    assert.equal(wiki.revisionCount, 3);
    const revisions = await db.sql`
      SELECT seq, body_md, kind FROM vault.wiki_revisions WHERE wiki_id = ${id} ORDER BY seq`;
    assert.deepEqual(
      revisions.map((r) => [r.seq, r.body_md, r.kind]),
      [
        [1, '처음', 'ai'],
        [2, '고침', 'ai'],
        [3, '처음', 'human'],
      ],
    );
    const [set] = await db.sql`SELECT reverted_by FROM vault.change_sets WHERE id = ${revised.id}`;
    assert.equal(set?.reverted_by, result.id);
    const undone = await db.sql`SELECT undone_by FROM vault.changes WHERE batch_id = ${revised.id}`;
    assert.deepEqual(
      undone.map((r) => r.undone_by),
      [result.id],
    );
  });

  test('wiki.create를 되돌리면 휴지통으로 가고 판은 남는다', async () => {
    const title = `만들기 되돌리기 ${randomUUID()}`;
    const set = await submit([{ op: 'wiki.create', payload: { title, body_md: '본문' } }]);
    const [row] = await db.sql`
      SELECT target_id FROM vault.change_ops WHERE change_set_id = ${set.id}`;
    ok(await revert(set.id));
    assert.equal((await api.get(`/api/wikis/${row?.target_id}`, owner)).status, 404);
    const revisions = await db.sql`
      SELECT 1 FROM vault.wiki_revisions WHERE wiki_id = ${String(row?.target_id)}`;
    assert.equal(revisions.length, 1);
  });

  test('세션 대표와 선을 함께 되돌린다. 사람이 되돌린 선은 AI가 다시 만들지 못한다', async () => {
    const session = await aSession();
    const a = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const b = await aiWiki(`끝 ${randomUUID()}`, '본문');
    const set = await submit([
      { op: 'session.assign', target_id: session, payload: { wiki_id: a } },
      { op: 'edge.add', payload: { src: a, dst: b, kind: 'link' } },
    ]);
    ok(await revert(set.id));
    assert.equal((await sessionRow(session)).wikiId, null);
    const again = await submit([{ op: 'edge.add', payload: { src: a, dst: b, kind: 'link' } }]);
    assert.equal(again.ops[0]?.status, 'rejected');
  });

  test('같은 대상이 나중에 바뀌었으면 409로 멈추고 아무것도 바꾸지 않는다', async () => {
    const id = await aiWiki(`나중 ${randomUUID()}`, '처음');
    const first = await submit([
      { op: 'wiki.revise', target_id: id, payload: { body_md: '둘째' } },
    ]);
    const second = await submit([
      { op: 'wiki.revise', target_id: id, payload: { body_md: '셋째' } },
    ]);
    const refused = await revert(first.id);
    assert.equal(refused.status, 409, refused.text);
    assert.equal(refused.json().code, 'conflict');
    const wiki = await getWiki(id);
    assert.deepEqual([wiki.bodyMd, wiki.revisionCount], ['셋째', 3]);
    const [row] = await db.sql`SELECT reverted_by FROM vault.change_sets WHERE id = ${first.id}`;
    assert.equal(row?.reverted_by, null);
    // 나중 묶음부터 되돌리면 된다
    ok(await revert(second.id));
    assert.equal((await getWiki(id)).bodyMd, '둘째');
  });

  test('이미 되돌렸거나 version이 어긋나면 409, 바뀐 것이 없으면 422', async () => {
    const id = await aiWiki(`두 번 ${randomUUID()}`, '처음');
    const set = await submit([{ op: 'wiki.revise', target_id: id, payload: { body_md: '고침' } }]);
    assert.equal((await revert(set.id, 99)).status, 409);
    ok(await revert(set.id));
    assert.equal((await revert(set.id)).status, 409);

    const empty = await submit([
      { op: 'category.create', payload: { name: `빈 ${randomUUID()}` } },
    ]);
    ok(await decide(empty.id, 1, 'decline'));
    assert.equal((await revert(empty.id)).status, 422);
  });

  test('기다리던 변경이 있는 묶음을 되돌리면 그 변경은 밀려난다', async () => {
    const id = await aiWiki(`기다림 ${randomUUID()}`, '처음');
    const set = await submit([
      { op: 'wiki.revise', target_id: id, payload: { body_md: '고침' } },
      { op: 'category.create', payload: { name: `기다림 ${randomUUID()}` } },
    ]);
    assert.deepEqual(
      set.ops.map((o) => o.status),
      ['applied', 'waiting'],
    );
    ok(await revert(set.id));
    assert.equal((await getWiki(id)).bodyMd, '처음');
    const [op] = await db.sql`
      SELECT status FROM vault.change_ops WHERE change_set_id = ${set.id} AND seq = 2`;
    assert.equal(op?.status, 'superseded');
    const [row] = await db.sql`SELECT status FROM vault.change_sets WHERE id = ${set.id}`;
    assert.equal(row?.status, 'done');
  });

  test('되돌린 묶음을 되돌리면 다시 적용된다', async () => {
    const id = await aiWiki(`다시 ${randomUUID()}`, '처음');
    const set = await submit([{ op: 'wiki.revise', target_id: id, payload: { body_md: '고침' } }]);
    const undone = ok(await revert(set.id));
    ok(await revert(String(undone.id), Number(undone.version)));
    assert.equal((await getWiki(id)).bodyMd, '고침');
  });
});

describe('관리 화면 편집', () => {
  test('규칙을 거치지 않고 묶음(human)으로 남는다', async () => {
    const id = await aiWiki(`사람 ${randomUUID()}`, '처음');
    const { version } = await getWiki(id);
    const set = await edit(
      new WikiReviseOp(1, id, Number(version), null, WikiBody.parse('사람'), null),
    );
    const { kind, status, ops } = set.view().toJSON();
    const [row] = await db.sql`SELECT actor_type FROM vault.change_sets WHERE id = ${set.id}`;
    assert.deepEqual([kind, status, row?.actor_type], ['human', 'done', 'user']);
    assert.equal(ops[0]?.verdict, 'merge');
    assert.equal(ops[0]?.rule, null);
  });

  test('version이 어긋나면 409, 없는 대상은 404', async () => {
    const id = await aiWiki(`충돌 ${randomUUID()}`, '처음');
    const old = new WikiReviseOp(1, id, 99, null, WikiBody.parse('사람'), null);
    await assert.rejects(() => edit(old), /먼저 바뀌었어요/);
    const nothing = new WikiReviseOp(1, randomUUID(), 1, null, WikiBody.parse('사람'), null);
    await assert.rejects(() => edit(nothing), /찾을 수 없어요/);
  });
});
