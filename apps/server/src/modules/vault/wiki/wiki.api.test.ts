import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// wiki 메뉴와 AI의 읽기 도구. 쓰기는 주인만, 읽기는 볼 수 있는 만큼만. 볼 수 없는 wiki는 없는 wiki와 똑같이 답한다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
/** read_public만 있는 기기 */
let publicReader: string;
/** read_all이 있는 기기 */
let allReader: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json): Promise<{ ok: boolean; body: Json }> {
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

const newWiki = async (title: string, bodyMd = '## 배경\n\n첫', more: Json = {}): Promise<Json> =>
  ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title,
      bodyMd,
      ...more,
    }),
    201,
  );

const put = (id: unknown, body: Json) => api.request('PUT', `/api/wikis/${id}`, owner, body);

async function publish(wiki: Json): Promise<Json> {
  return ok(
    await put(wiki.id, {
      version: wiki.version,
      title: wiki.title,
      bodyMd: wiki.bodyMd,
      visibility: 'public',
    }),
  );
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  publicReader = await api.connectDevice(owner, 'wiki-public');
  allReader = await api.connectDevice(owner, 'wiki-all');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; version: number }[];
  };
  const device = devices.find((d) => d.name === 'wiki-all');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: ['read_all'],
      version: device?.version,
    }),
  );
});
after(() => api.close());

describe('만들기', () => {
  test('사람이 만든 wiki는 비공개이고 칸이 사람의 것이다', async () => {
    const wiki = await newWiki('세션 저장 정리', '## 배경\n\n첫\n\n## 결론\n\n끝');
    assert.equal(wiki.slug, '세션-저장-정리');
    assert.deepEqual(
      [wiki.visibility, wiki.origin, wiki.revisionCount, wiki.version],
      ['private', 'human', 1, 1],
    );
    assert.deepEqual([...(wiki.pinnedSections as string[])].sort(), ['#title', '결론', '배경']);
    assert.equal(typeof wiki.changeSetId, 'string');
    assert.deepEqual(
      (wiki.sections as Json[]).map((s) => s.key),
      ['배경', '결론'],
    );
  });

  test('같은 requestId는 처음 만든 wiki를 돌려준다', async () => {
    const body = { requestId: randomUUID(), title: `한 번 ${randomUUID()}`, bodyMd: '본문' };
    const first = ok(await api.request('POST', '/api/wikis', owner, body), 201);
    const second = ok(await api.request('POST', '/api/wikis', owner, body), 201);
    assert.equal(second.id, first.id);
    assert.equal(second.changeSetId, first.changeSetId);
  });

  test('제목에서 만든 주소가 겹치면 번호를 붙이고, 정한 주소가 겹치면 409', async () => {
    const title = `겹침 ${randomUUID()}`;
    const first = await newWiki(title);
    const second = await newWiki(title);
    assert.equal(second.slug, `${first.slug}-2`);
    const taken = await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: '다른 제목',
      slug: first.slug,
    });
    assert.equal(taken.status, 409, taken.text);
  });

  test('없는 카테고리면 404, 모양이 틀리면 400, 주인이 아니면 403', async () => {
    const missing = await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: '제목',
      categoryId: randomUUID(),
    });
    assert.equal(missing.status, 404, missing.text);
    const bad = await api.request('POST', '/api/wikis', owner, { title: '제목' });
    assert.equal(bad.status, 400);
    const visitor = await api.request('POST', '/api/wikis', TestUser.visitor, {
      requestId: randomUUID(),
      title: '제목',
    });
    assert.equal(visitor.status, 403);
    assert.equal(
      (await put(randomUUID(), { version: 1, title: '제목', bodyMd: '본문' })).status,
      404,
    );
  });
});

describe('고치기', () => {
  test('고치면 새 판이 쌓이고 바뀐 칸만 사람의 것으로 더한다', async () => {
    const res = await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: `고치기 ${randomUUID()}`,
      bodyMd: '## 가\n\n1',
    });
    const wiki = ok(res, 201);
    const saved = ok(
      await put(wiki.id, {
        version: wiki.version,
        title: wiki.title,
        bodyMd: '## 가\n\n1\n\n## 나\n\n2',
      }),
    );
    assert.equal(saved.version, 2);
    assert.equal(saved.revisionCount, 2);
    assert.deepEqual([...(saved.pinnedSections as string[])].sort(), ['#title', '가', '나']);
  });

  test('version이 어긋나면 409', async () => {
    const wiki = await newWiki(`충돌 ${randomUUID()}`);
    const res = await put(wiki.id, { version: 9, title: wiki.title, bodyMd: '고침' });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.json().code, 'conflict');
  });

  test('본문을 비울 수 있지만 빠뜨리면 400', async () => {
    const wiki = await newWiki(`비우기 ${randomUUID()}`);
    assert.equal((await put(wiki.id, { version: wiki.version, title: wiki.title })).status, 400);
    const saved = ok(await put(wiki.id, { version: wiki.version, title: wiki.title, bodyMd: '' }));
    assert.equal(saved.bodyMd, '');
  });

  test('카테고리는 보낼 때만 바뀐다', async () => {
    const category = ok(
      await api.request('POST', '/api/categories', owner, {
        requestId: randomUUID(),
        name: `옮길 곳 ${randomUUID()}`,
      }),
      201,
    );
    const wiki = await newWiki(`옮기기 ${randomUUID()}`);
    const moved = ok(
      await put(wiki.id, {
        version: wiki.version,
        title: wiki.title,
        bodyMd: wiki.bodyMd,
        categoryId: category.id,
      }),
    );
    assert.equal(moved.categoryId, category.id);
    assert.equal(moved.version, 2);
    const kept = ok(
      await put(wiki.id, { version: moved.version, title: wiki.title, bodyMd: '고침' }),
    );
    assert.equal(kept.categoryId, category.id);
    const cleared = ok(
      await put(wiki.id, {
        version: kept.version,
        title: wiki.title,
        bodyMd: '고침',
        categoryId: null,
      }),
    );
    assert.equal(cleared.categoryId, null);
  });

  test('공개 여부의 값이 틀리면 422', async () => {
    const wiki = await newWiki(`값 ${randomUUID()}`);
    const res = await put(wiki.id, {
      version: wiki.version,
      title: wiki.title,
      bodyMd: wiki.bodyMd,
      visibility: 'everyone',
    });
    assert.equal(res.status, 422, res.text);
  });
});

describe('보는 사람', () => {
  const secretWord = `비공개말${randomUUID().slice(0, 8)}`;
  const publicWord = `공개말${randomUUID().slice(0, 8)}`;
  let hidden: Json;
  let shown: Json;

  before(async () => {
    hidden = await newWiki(`${secretWord} 문서`, `## 칸\n\n${secretWord} 본문`);
    shown = await publish(await newWiki(`${publicWord} 문서`, `## 칸\n\n${publicWord} 본문`));
  });

  test('방문자는 공개 wiki만 보고, 관리용 칸은 보이지 않는다', async () => {
    const page = ok(await api.get(`/api/wikis?q=${encodeURIComponent(publicWord)}`));
    assert.deepEqual(
      (page.wikis as Json[]).map((w) => w.id),
      [shown.id],
    );
    const one = (page.wikis as Json[])[0] ?? {};
    assert.deepEqual(Object.keys(one).sort(), ['categoryId', 'id', 'slug', 'title', 'updatedAt']);
    const detail = ok(await api.get(`/api/wikis/${shown.id}`));
    assert.equal(detail.pinnedSections, undefined);
    assert.equal(detail.visibility, undefined);
    assert.match(String(detail.bodyMd), new RegExp(publicWord));
  });

  test('방문자에게 비공개 wiki는 없는 wiki와 똑같이 답한다', async () => {
    const hiddenRes = await api.get(`/api/wikis/${hidden.id}`);
    const noneRes = await api.get(`/api/wikis/${randomUUID()}`);
    assert.equal(hiddenRes.status, 404);
    assert.equal(hiddenRes.text, noneRes.text);
    const page = ok(await api.get(`/api/wikis?q=${encodeURIComponent(secretWord)}`));
    assert.deepEqual([page.wikis, page.next], [[], null]);
  });

  test('주인은 비공개까지 보고 모든 칸을 본다', async () => {
    const page = ok(await api.get(`/api/wikis?q=${encodeURIComponent(secretWord)}`, owner));
    assert.deepEqual(
      (page.wikis as Json[]).map((w) => w.id),
      [hidden.id],
    );
    const detail = ok(await api.get(`/api/wikis/${hidden.id}`, owner));
    assert.deepEqual(detail.visibility, 'private');
    assert.ok(Array.isArray(detail.pinnedSections));
  });

  test('read_public 기기에게 비공개 wiki는 찾기에도 읽기에도 없다', async () => {
    const found = await tool(publicReader, 'search_wikis', { query: secretWord });
    assert.deepEqual(found.body, { wikis: [], next: null });
    const hiddenRead = await tool(publicReader, 'get_wiki', { wiki_id: hidden.id });
    const noneRead = await tool(publicReader, 'get_wiki', { wiki_id: randomUUID() });
    assert.equal(hiddenRead.ok, false);
    assert.deepEqual(hiddenRead.body, noneRead.body);
    assert.equal(hiddenRead.body.code, 'not_found');
  });

  test('read_public 기기는 공개 wiki를 찾고 읽는다', async () => {
    const found = await tool(publicReader, 'search_wikis', { query: publicWord });
    const hits = found.body.wikis as Json[];
    assert.deepEqual(
      hits.map((w) => w.wiki_id),
      [shown.id],
    );
    assert.match(String(hits[0]?.excerpt), new RegExp(publicWord));
    const read = await tool(publicReader, 'get_wiki', { wiki_id: shown.id });
    assert.equal(read.ok, true);
    assert.equal(read.body.version, shown.version);
    assert.equal(read.body.title, shown.title);
    assert.equal(read.body.revision, shown.revisionCount);
    assert.deepEqual(
      (read.body.sections as Json[]).map((s) => s.key),
      ['칸'],
    );
    assert.deepEqual(read.body.body_md, shown.bodyMd);
  });

  test('read_all 기기는 비공개 wiki까지 찾고 읽는다', async () => {
    const found = await tool(allReader, 'search_wikis', { query: secretWord });
    assert.deepEqual(
      (found.body.wikis as Json[]).map((w) => w.wiki_id),
      [hidden.id],
    );
    assert.equal((await tool(allReader, 'get_wiki', { wiki_id: hidden.id })).ok, true);
  });

  test('공개를 거둔 wiki는 다시 안 보인다', async () => {
    const wiki = await publish(await newWiki(`거둠 ${randomUUID()}`));
    assert.equal((await api.get(`/api/wikis/${wiki.id}`)).status, 200);
    ok(
      await put(wiki.id, {
        version: wiki.version,
        title: wiki.title,
        bodyMd: wiki.bodyMd,
        visibility: 'private',
      }),
    );
    assert.equal((await api.get(`/api/wikis/${wiki.id}`)).status, 404);
  });
});

describe('찾기와 쪽 넘기기', () => {
  test('띄어 쓴 단어가 모두 있어야 찾고, 제목이나 본문 어디에 있어도 된다', async () => {
    const mark = `표식${randomUUID().slice(0, 8)}`;
    const both = await newWiki(`${mark} 제목`, '본문에는 사과가 있다');
    await newWiki(`${mark} 다른`, '본문에는 배가 있다');
    const page = ok(await api.get(`/api/wikis?q=${encodeURIComponent(`${mark} 사과`)}`, owner));
    assert.deepEqual(
      (page.wikis as Json[]).map((w) => w.id),
      [both.id],
    );
  });

  test('카테고리로 거른다', async () => {
    const category = ok(
      await api.request('POST', '/api/categories', owner, {
        requestId: randomUUID(),
        name: `거를 곳 ${randomUUID()}`,
      }),
      201,
    );
    const inside = await newWiki(`안 ${randomUUID()}`, '본문', { categoryId: category.id });
    await newWiki(`밖 ${randomUUID()}`);
    const page = ok(await api.get(`/api/wikis?category=${category.id}`, owner));
    assert.deepEqual(
      (page.wikis as Json[]).map((w) => w.id),
      [inside.id],
    );
  });

  test('목록은 커서로 넘기고 빠지거나 겹치지 않는다', async () => {
    const mark = `쪽${randomUUID().slice(0, 8)}`;
    const made: unknown[] = [];
    for (let i = 0; i < 32; i++) made.push((await newWiki(`${mark} ${i}`, '본문')).id);
    const seen: unknown[] = [];
    let cursor: unknown = null;
    do {
      const q = encodeURIComponent(mark);
      const path = cursor ? `/api/wikis?q=${q}&cursor=${cursor}` : `/api/wikis?q=${q}`;
      const page = ok(await api.get(path, owner)) as { wikis: Json[]; next: string | null };
      seen.push(...page.wikis.map((w) => w.id));
      cursor = page.next;
    } while (cursor);
    assert.deepEqual(seen, [...made].reverse());
    assert.equal((await api.get('/api/wikis?cursor=nope', owner)).status, 400);
  });

  test('search_wikis도 limit와 cursor로 넘긴다', async () => {
    const mark = `도구쪽${randomUUID().slice(0, 8)}`;
    await newWiki(`${mark} 하나`);
    await newWiki(`${mark} 둘`);
    const first = await tool(allReader, 'search_wikis', { query: mark, limit: 1 });
    assert.equal((first.body.wikis as Json[]).length, 1);
    const second = await tool(allReader, 'search_wikis', {
      query: mark,
      limit: 1,
      cursor: first.body.next,
    });
    assert.equal((second.body.wikis as Json[]).length, 1);
    assert.equal(second.body.next, null);
    assert.notDeepEqual(first.body.wikis, second.body.wikis);
  });
});

describe('휴지통과 대체 (wiki 점수)', () => {
  test('주인이 휴지통으로 보내면 목록 · 읽기에서 빠지고, 휴지통 목록에서 되살린다', async () => {
    const wiki = await newWiki(`지울 위키 ${randomUUID().slice(0, 8)}`);
    const trashed = ok(
      await api.request('POST', `/api/wikis/${wiki.id}/trash`, owner, { version: wiki.version }),
    );
    assert.equal(trashed.version, Number(wiki.version) + 1);
    assert.equal((await api.get(`/api/wikis/${wiki.id}`, owner)).status, 404);
    const listed = ok(await api.get('/api/wikis', owner)) as { wikis: Json[] };
    assert.equal(
      listed.wikis.some((w) => w.id === wiki.id),
      false,
    );

    const trash = ok(await api.get('/api/wikis/trash', owner)) as { wikis: Json[] };
    const row = trash.wikis.find((w) => w.id === wiki.id);
    assert.equal(row?.title, wiki.title);
    assert.ok(Date.parse(String(row?.purgeAfter)) > Date.parse(String(row?.deletedAt)));

    ok(
      await api.request('POST', `/api/wikis/${wiki.id}/restore`, owner, { version: row?.version }),
    );
    assert.equal(ok(await api.get(`/api/wikis/${wiki.id}`, owner)).title, wiki.title);
    const after = ok(await api.get('/api/wikis/trash', owner)) as { wikis: Json[] };
    assert.equal(
      after.wikis.some((w) => w.id === wiki.id),
      false,
    );
  });

  test('휴지통 · 되살리기 · 대체는 주인만: 방문자 · 기기 403, version이 어긋나면 409', async () => {
    const wiki = await newWiki(`남길 위키 ${randomUUID().slice(0, 8)}`);
    const other = await newWiki(`옛 위키 ${randomUUID().slice(0, 8)}`);
    const calls: [string, string, Json][] = [
      ['POST', `/api/wikis/${wiki.id}/trash`, { version: wiki.version }],
      ['POST', `/api/wikis/${wiki.id}/restore`, { version: wiki.version }],
      ['POST', `/api/wikis/${wiki.id}/replaces`, { oldId: other.id }],
      ['DELETE', `/api/wikis/${wiki.id}/replaces/${other.id}`, {}],
    ];
    for (const [method, path, body] of calls)
      assert.equal((await api.request(method, path, undefined, body)).status, 403, path);
    assert.equal((await api.get('/api/wikis/trash')).status, 403);
    const res = await fetch(`${api.baseUrl}/api/wikis/trash`, {
      headers: { authorization: `Bearer ${allReader}` },
    });
    assert.equal(res.status, 403);
    const stale = await api.request('POST', `/api/wikis/${wiki.id}/trash`, owner, {
      version: Number(wiki.version) + 5,
    });
    assert.equal(stale.status, 409);
  });

  test('대체: 새 wiki가 옛 wiki를 대체하면 옛 wiki는 히스토리, 서로 대체 · 두 번 대체는 막는다', async () => {
    const old = await newWiki(`옛 결론 ${randomUUID().slice(0, 8)}`);
    const next = await newWiki(`새 결론 ${randomUUID().slice(0, 8)}`);
    const third = await newWiki(`또 다른 결론 ${randomUUID().slice(0, 8)}`);
    const set = ok(
      await api.request('POST', `/api/wikis/${next.id}/replaces`, owner, { oldId: old.id }),
      201,
    );
    assert.equal(set.status, 'done');

    const back = await api.request('POST', `/api/wikis/${old.id}/replaces`, owner, {
      oldId: next.id,
    });
    assert.equal(back.status, 422, back.text);
    const twice = await api.request('POST', `/api/wikis/${third.id}/replaces`, owner, {
      oldId: old.id,
    });
    assert.equal(twice.status, 409, twice.text);

    const score = ok(await api.get(`/api/wiki-scores/${old.id}`, owner)) as { wiki: Json };
    assert.equal(score.wiki.replacedBy, next.id);

    ok(await api.request('DELETE', `/api/wikis/${next.id}/replaces/${old.id}`, owner));
    const freed = ok(await api.get(`/api/wiki-scores/${old.id}`, owner)) as { wiki: Json };
    assert.equal(freed.wiki.replacedBy, null);
    const read = await tool(allReader, 'get_wiki', { wiki_id: old.id });
    assert.equal(read.ok, true, '히스토리도 읽을 수 있다');
  });
});
