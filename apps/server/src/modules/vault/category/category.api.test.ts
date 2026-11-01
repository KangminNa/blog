import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// 그래프 카테고리. 이름은 공개, 쓰기는 주인만. wiki가 남은 카테고리는 지우지 못한다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const create = (body: Json) =>
  api.request('POST', '/api/categories', owner, { requestId: randomUUID(), ...body });

const newCategory = async (more: Json = {}): Promise<Json> =>
  ok(await create({ name: `구역 ${randomUUID()}`, ...more }), 201);

const patch = (id: unknown, body: Json) =>
  api.request('PATCH', `/api/categories/${id}`, owner, body);

const remove = (id: unknown, version: unknown) =>
  api.request('DELETE', `/api/categories/${id}`, owner, { version });

const listed = async (as?: TestUser): Promise<Json[]> =>
  ok(await api.get('/api/categories', as)).categories as Json[];

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
});
after(() => api.close());

describe('카테고리', () => {
  test('만들면 사람의 것이고 묶음으로 남는다', async () => {
    const category = await newCategory({
      color: '#000000',
      description: 'AI 정리 기준',
      sort: 3,
    });
    assert.deepEqual(
      [category.origin, category.version, category.sort, category.description],
      ['human', 1, 3, 'AI 정리 기준'],
    );
    assert.equal(typeof category.changeSetId, 'string');
  });

  test('같은 requestId는 처음 만든 카테고리를 돌려준다', async () => {
    const body = { requestId: randomUUID(), name: `한 번 ${randomUUID()}` };
    const first = ok(await api.request('POST', '/api/categories', owner, body), 201);
    const second = ok(await api.request('POST', '/api/categories', owner, body), 201);
    assert.equal(second.id, first.id);
  });

  test('주소가 겹치면 409 (이름에서 만든 주소는 번호를 붙인다)', async () => {
    const name = `겹침 ${randomUUID()}`;
    const first = await newCategory({ name });
    const second = await newCategory({ name });
    assert.equal(second.slug, `${first.slug}-2`);
    assert.equal((await create({ name: '다른 이름', slug: first.slug })).status, 409);
    const res = await patch(second.id, { version: second.version, slug: first.slug });
    assert.equal(res.status, 409, res.text);
  });

  test('방문자는 이름만 보고, 주인은 분류 기준까지 본다', async () => {
    const category = await newCategory({ description: '속 기준' });
    const seen = (await listed()).find((c) => c.id === category.id) ?? {};
    assert.deepEqual(Object.keys(seen).sort(), ['color', 'id', 'name', 'slug', 'sort']);
    const full = (await listed(owner)).find((c) => c.id === category.id);
    assert.equal(full?.description, '속 기준');
  });

  test('목록은 순서대로', async () => {
    const later = await newCategory({ sort: 900_000 });
    const sooner = await newCategory({ sort: 899_999 });
    const ids = (await listed()).map((c) => c.id);
    assert.ok(ids.indexOf(sooner.id) < ids.indexOf(later.id));
  });

  test('보낸 칸만 고치고, null을 보내면 비운다. version이 어긋나면 409', async () => {
    const category = await newCategory({ color: '#000000', description: '기준' });
    const saved = ok(
      await patch(category.id, { version: category.version, name: '새 이름', color: null }),
    );
    assert.deepEqual(
      [saved.name, saved.color, saved.description, saved.version],
      ['새 이름', null, '기준', 2],
    );
    assert.equal((await patch(category.id, { version: 1, name: '늦음' })).status, 409);
  });

  test('없는 카테고리는 404, 주인이 아니면 403', async () => {
    assert.equal((await patch(randomUUID(), { version: 1, name: '이름' })).status, 404);
    assert.equal((await remove(randomUUID(), 1)).status, 404);
    const visitor = await api.request('POST', '/api/categories', TestUser.visitor, {
      requestId: randomUUID(),
      name: '이름',
    });
    assert.equal(visitor.status, 403);
    const stranger = await api.request(
      'DELETE',
      `/api/categories/${randomUUID()}`,
      TestUser.visitor,
      {
        version: 1,
      },
    );
    assert.equal(stranger.status, 403);
  });

  test('지우면 목록에서 빠지고, 주소는 휴지통에 남아 있어 다시 쓸 수 없다', async () => {
    const category = await newCategory();
    ok(await remove(category.id, category.version));
    assert.equal(
      (await listed()).some((c) => c.id === category.id),
      false,
    );
    assert.equal((await create({ name: '다른', slug: category.slug })).status, 409);
  });

  test('wiki가 남아 있으면 지우지 못한다 (409). 옮긴 뒤에는 지운다', async () => {
    const category = await newCategory();
    const wiki = ok(
      await api.request('POST', '/api/wikis', owner, {
        requestId: randomUUID(),
        title: `남은 wiki ${randomUUID()}`,
        categoryId: category.id,
      }),
      201,
    );
    const refused = await remove(category.id, category.version);
    assert.equal(refused.status, 409, refused.text);
    assert.ok((await listed()).some((c) => c.id === category.id));
    ok(
      await api.request('PUT', `/api/wikis/${wiki.id}`, owner, {
        version: wiki.version,
        title: wiki.title,
        bodyMd: '',
        categoryId: null,
      }),
    );
    ok(await remove(category.id, category.version));
  });

  test('지운 카테고리에는 wiki를 넣지 못한다', async () => {
    const category = await newCategory();
    ok(await remove(category.id, category.version));
    const res = await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: '제목',
      categoryId: category.id,
    });
    assert.equal(res.status, 404, res.text);
  });

  test('지운 것을 되돌리면 다시 나타난다', async () => {
    const category = await newCategory();
    const gone = ok(await remove(category.id, category.version));
    const undone = await api.request('POST', `/api/changes/${gone.changeSetId}/revert`, owner, {
      version: 1,
    });
    assert.equal(undone.status, 200, undone.text);
    assert.ok((await listed()).some((c) => c.id === category.id));
  });
});
