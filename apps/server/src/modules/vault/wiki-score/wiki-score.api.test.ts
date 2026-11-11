import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, DomainEvent, Outbox, OutboxWorker } from '../../platform';

// wiki 점수 (docs/wiki점수.md). 주인만 본다: 비공개 세션 · wiki의 쓰임이 섞인 값이다.
// 문서의 A · B · C 예를 실제 DB의 날짜로 다시 만들어 같은 숫자가 나오는지 본다.

type Json = Record<string, unknown>;
type Item = {
  id: string;
  title: string;
  score: number;
  total: number;
  accumulated: number;
  inherited: number;
  uses: number;
  lastUsedAt: string;
  replacedBy: string | null;
};
type Board = { halfLifeDays: number; cited: number; groups: Json[]; history: Item[] };

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let spaceId: string;
/** 기본 권한 (upload · read_public) */
let laptop: string;
/** read_all · tidy: 선을 잇는다 */
let tidier: string;

const named = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

function near(actual: unknown, expected: number, label: string): void {
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) < 1e-3,
    `${label}: ${actual} ≠ ${expected}`,
  );
}

async function call(token: string, name: string, args: Json): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.notEqual(result.isError, true, res.text);
  return result.structuredContent ?? {};
}

async function newWiki(more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: named('wiki'),
      bodyMd: '## 본문\n내용',
      ...more,
    }),
    201,
  );
}

/** 선은 변경 묶음으로만 생긴다 */
async function addEdge(src: unknown, dst: unknown, kind: string): Promise<void> {
  const set = await call(tidier, 'submit_changes', {
    request_id: randomUUID(),
    message: '선 잇기',
    ops: [{ op: 'edge.add', payload: { src, dst, kind } }],
  });
  assert.equal((set.ops as Json[])[0]?.status, 'applied', JSON.stringify(set));
}

/** 날짜를 옮긴다: wiki를 만든 날, 링크가 생긴 날 (며칠 전) */
async function wikiBornDaysAgo(id: unknown, days: number): Promise<void> {
  await db.sql`
    UPDATE vault.wikis SET created_at = now() - make_interval(days => ${days})
    WHERE node_id = ${String(id)}`;
}

async function linkDaysAgo(a: unknown, b: unknown, days: number): Promise<void> {
  await db.sql`
    UPDATE vault.edges SET created_at = now() - make_interval(days => ${days})
    WHERE kind = 'link' AND ((src = ${String(a)} AND dst = ${String(b)})
                          OR (src = ${String(b)} AND dst = ${String(a)}))`;
}

async function newSession(wikiId: unknown): Promise<string> {
  const saved = await call(laptop, 'save_session', {
    request_id: randomUUID(),
    source_session_id: randomUUID(),
    tool: 'claude-code',
    project: 'cairn',
    title: named('세션'),
    did: '한 일',
  });
  const id = String(saved.session_id);
  await db.sql`UPDATE vault.sessions SET wiki_id = ${wikiId as string | null} WHERE node_id = ${id}`;
  return id;
}

/** blog가 보낸 것처럼 글 이벤트를 outbox와 일꾼으로 흘린다 */
async function publishPost(main: unknown, refs: unknown[]): Promise<void> {
  const event = new DomainEvent('blog.post.published', 1, spaceId, {
    postId: randomUUID(),
    slug: named('글').replace(' ', '-'),
    title: named('글'),
    status: 'published',
    postVersion: 1,
    mainWikiId: main,
    refWikiIds: refs,
  });
  await db.transaction((tx) => new Outbox(tx).publish([event]));
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

const board = async (): Promise<Board> =>
  ok(await api.get('/api/wiki-scores', owner)) as unknown as Board;

const itemOf = (b: Board, id: unknown): Item | undefined =>
  [...b.groups.flatMap((g) => g.wikis as Item[]), ...b.history].find((w) => w.id === id);

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  // 기기 연결(OAuth)은 블로그 주소를 본다
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  laptop = await api.connectDevice(owner, 'score-laptop');
  tidier = await api.connectDevice(owner, 'score-tidier');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; version: number }[];
  };
  const device = devices.find((d) => d.name === 'score-tidier');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: ['read_all', 'tidy'],
      version: device?.version,
    }),
  );
  const { id } = await newWiki();
  const [wiki] = await db.sql`SELECT space_id FROM vault.wikis WHERE node_id = ${String(id)}`;
  spaceId = String(wiki?.space_id);
});

after(() => api.close());

describe('wiki 점수', () => {
  test('방문자와 기기는 볼 수 없다 (403)', async () => {
    const { id } = await newWiki();
    for (const path of ['/api/wiki-scores', `/api/wiki-scores/${id}`]) {
      assert.equal((await api.get(path)).status, 403, path);
      const res = await fetch(`${api.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${tidier}` },
      });
      assert.equal(res.status, 403, path);
    }
  });

  test('문서의 A · B · C: 카테고리 안의 순위는 B · A · C, 점수는 2.125 · 1.75 · 1.625', async () => {
    const category = ok(
      await api.request('POST', '/api/categories', owner, {
        requestId: randomUUID(),
        name: named('구역'),
      }),
      201,
    );
    const a = await newWiki({ categoryId: category.id });
    const b = await newWiki({ categoryId: category.id });
    const c = await newWiki({ categoryId: category.id });
    await addEdge(b.id, a.id, 'link');
    await addEdge(c.id, a.id, 'link');
    await addEdge(c.id, b.id, 'link');
    await wikiBornDaysAgo(a.id, 180);
    await wikiBornDaysAgo(b.id, 90);
    await linkDaysAgo(a.id, b.id, 90);

    const scores = await board();
    assert.equal(scores.halfLifeDays, 90);
    assert.equal(scores.cited, 0.5);
    const group = scores.groups.find((g) => g.categoryId === category.id);
    assert.equal(group?.name, category.name);
    const ranked = group?.wikis as Item[];
    assert.deepEqual(
      ranked.map((w) => w.id),
      [b.id, a.id, c.id],
    );
    near(ranked[0]?.total, 2.125, 'S_B');
    near(ranked[0]?.accumulated, 1.5, 'A_B');
    near(ranked[0]?.inherited, 0.625, 'B 물려받음');
    near(ranked[1]?.total, 1.75, 'S_A');
    assert.equal(ranked[1]?.uses, 2);
    near(ranked[2]?.total, 1.625, 'S_C');
    for (const w of ranked) assert.ok(w.score > 0 && w.score <= 100, String(w.score));

    const detail = ok(await api.get(`/api/wiki-scores/${c.id}`, owner)) as {
      wiki: Item;
      bases: { wikiId: string; title: string; ratio: number; amount: number }[];
    };
    near(detail.wiki.total, 1.625, '상세 S_C');
    const fromA = detail.bases.find((x) => x.wikiId === a.id);
    assert.equal(fromA?.title, a.title);
    assert.equal(fromA?.ratio, 0.5);
    near(fromA?.amount, 0.375, 'C가 A에게서');
    near(detail.bases.find((x) => x.wikiId === b.id)?.amount, 0.25, 'C가 B에게서');
  });

  test('세션 · 글은 쓰임만 준다: 하나에 한 번씩, 미분류는 끝의 무리에', async () => {
    const w = await newWiki();
    await newSession(w.id);
    const material = await newSession(null);
    await addEdge(material, w.id, 'material');
    await publishPost(w.id, [w.id]);

    const scores = await board();
    const item = itemOf(scores, w.id);
    assert.equal(item?.uses, 3);
    near(item?.total, 4, 'S');
    const last = scores.groups.at(-1);
    assert.equal(last?.categoryId, null);
    assert.ok(((last?.wikis ?? []) as Item[]).some((x) => x.id === w.id));
  });

  test('아무도 쓰지 않은 wiki는 시간이 지나면 줄어든다: 90일이면 0.5', async () => {
    const w = await newWiki();
    await wikiBornDaysAgo(w.id, 90);
    near(itemOf(await board(), w.id)?.total, 0.5, '90일');
  });

  test('대체한 wiki는 옛 wiki를 전부 물려받고, 옛 wiki는 히스토리로 순위에서 빠진다', async () => {
    const old = await newWiki();
    const next = await newWiki();
    ok(await api.request('POST', `/api/wikis/${next.id}/replaces`, owner, { oldId: old.id }), 201);
    const scores = await board();
    const ranked = scores.groups.flatMap((g) => g.wikis as Item[]);
    assert.equal(
      ranked.some((w) => w.id === old.id),
      false,
    );
    const history = scores.history.find((w) => w.id === old.id);
    assert.equal(history?.replacedBy, next.id);
    near(history?.accumulated, 2, '만든 날 + 대체된 날');
    const item = itemOf(scores, next.id);
    near(item?.inherited, 1, '옛 wiki의 쌓인 점수 2 - 내가 준 1');
    near(item?.total, 2, 'S');
    const detail = ok(await api.get(`/api/wiki-scores/${next.id}`, owner)) as {
      bases: { wikiId: string; ratio: number }[];
    };
    assert.equal(detail.bases.find((b) => b.wikiId === old.id)?.ratio, 1);
  });

  test('휴지통의 wiki는 점수를 받지 않고 쓰임도 주지 않는다', async () => {
    const old = await newWiki();
    const gone = await newWiki();
    await addEdge(gone.id, old.id, 'link');
    await db.sql`UPDATE vault.nodes SET deleted_at = now() WHERE id = ${String(gone.id)}`;
    const scores = await board();
    assert.equal(itemOf(scores, gone.id), undefined);
    near(itemOf(scores, old.id)?.total, 1, '휴지통의 링크는 세지 않음');
    assert.equal((await api.get(`/api/wiki-scores/${gone.id}`, owner)).status, 404);
    assert.equal((await api.get(`/api/wiki-scores/${randomUUID()}`, owner)).status, 404);
  });
});
