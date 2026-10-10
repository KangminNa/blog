import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

// 플러그인 API: 보는 사람마다 정해진 것만 나가는지, 켜고 끄면 재시작 없이 바뀌는지, 비밀값이 새지 않는지.
// 켜기·설정도 API로 한다 (설치 마법사의 플러그인 단계와 관리 화면이 쓰는 길).

let api: ApiClient;
let owner: TestUser;
const TOKEN = 'ghp_never_leaks_123';

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  await api.request('POST', '/api/plugins/comments-giscus/disable', owner);
  await api.request('POST', '/api/plugins/sync-github/disable', owner);
  await api.request('POST', '/api/plugins/login-github/disable', owner);
});
after(() => api.close());

describe('GET /api/plugins', () => {
  test('방문자: 켜진 플러그인이 없으면 빈 목록', async () => {
    const res = await api.get('/api/plugins');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { plugins: [] });
  });

  test('주인: 들어 있는 플러그인 전부와 설정 칸, 필요한 권한', async () => {
    const list = (await api.get('/api/plugins', owner)).json().plugins as Record<string, unknown>[];
    assert.deepEqual(
      list.map((p) => p.name),
      ['comments-giscus', 'login-github', 'sync-github'],
    );
    const sync = list.find((p) => p.name === 'sync-github') as Record<string, unknown>;
    assert.equal(sync.enabled, false);
    assert.deepEqual(sync.uses, ['archive:read', 'job:sync', 'action:check', 'action:sync-now']);
    const token = (sync.settings as Record<string, unknown>[]).find((s) => s.key === 'token');
    assert.deepEqual(token, {
      key: 'token',
      label: 'GitHub 토큰',
      type: 'secret',
      required: true,
      help: 'Fine-grained token, 그 저장소의 Contents 읽기·쓰기 권한',
      options: [],
      value: null,
      isSet: false,
    });
  });
});

describe('켜기 → 공개 설정', () => {
  test('방문자는 켜거나 설정할 수 없다 (403)', async () => {
    assert.equal((await api.request('POST', '/api/plugins/comments-giscus/enable')).status, 403);
    const res = await api.request(
      'PUT',
      '/api/plugins/comments-giscus/settings',
      TestUser.visitor,
      {
        values: { repo: 'x/y' },
      },
    );
    assert.equal(res.status, 403);
  });

  test('켜고 값을 넣으면 재시작 없이 공개 설정이 나간다', async () => {
    const enabled = await api.request('POST', '/api/plugins/comments-giscus/enable', owner);
    assert.deepEqual(enabled.json(), { name: 'comments-giscus', enabled: true });
    const saved = await api.request('PUT', '/api/plugins/comments-giscus/settings', owner, {
      values: { repo: 'me/blog', repoId: 'R_1', category: 'Comments', categoryId: 'DIC_1' },
    });
    assert.equal(saved.status, 200);
    const res = await api.get('/api/plugins/comments-giscus/settings');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), {
      name: 'comments-giscus',
      ready: true,
      settings: { repo: 'me/blog', repoId: 'R_1', category: 'Comments', categoryId: 'DIC_1' },
    });
  });

  test('없는 설정 칸이 섞여 있으면 404이고 아무것도 바뀌지 않는다', async () => {
    const res = await api.request('PUT', '/api/plugins/comments-giscus/settings', owner, {
      values: { repo: 'changed/repo', nope: 'x' },
    });
    assert.equal(res.status, 404);
    const settings = (await api.get('/api/plugins/comments-giscus/settings')).json().settings;
    assert.equal((settings as Record<string, string>).repo, 'me/blog');
  });

  test('방문자 목록에는 켜진 것만, 주인 전용 정보(설정 칸·권한)는 빠진다', async () => {
    const res = await api.get('/api/plugins');
    assert.deepEqual(res.json(), {
      plugins: [
        {
          name: 'comments-giscus',
          version: '0.1.0',
          description:
            '글 아래에 giscus 댓글을 붙인다. 댓글은 GitHub Discussions에 저장되고, 독자는 GitHub 계정으로 쓴다',
          webSlots: ['post.after'],
        },
      ],
    });
  });
});

describe('비밀값', () => {
  test('토큰은 어떤 응답에도 나오지 않고 "설정됨"으로만 보인다', async () => {
    await api.request('POST', '/api/plugins/sync-github/enable', owner);
    const saved = await api.request('PUT', '/api/plugins/sync-github/settings', owner, {
      values: { token: TOKEN },
    });
    assert.equal(saved.text.includes(TOKEN), false);

    const ownerList = await api.get('/api/plugins', owner);
    assert.equal(ownerList.text.includes(TOKEN), false);
    const sync = (ownerList.json().plugins as Record<string, unknown>[]).find(
      (p) => p.name === 'sync-github',
    ) as Record<string, unknown>;
    const token = (sync.settings as Record<string, unknown>[]).find((s) => s.key === 'token');
    assert.equal(token?.value, null);
    assert.equal(token?.isSet, true);
    assert.deepEqual(sync.missing, ['repo'], '필수인데 빈 것은 저장소뿐');

    const publicSettings = await api.get('/api/plugins/sync-github/settings');
    assert.deepEqual(publicSettings.json(), { name: 'sync-github', ready: false, settings: {} });
    assert.equal(publicSettings.text.includes(TOKEN), false);
  });
});

describe('관리 동작', () => {
  test('주인은 관리 동작을 부르고 결과를 받는다, 없는 동작은 404', async () => {
    const res = await api.request('POST', '/api/plugins/sync-github/actions/check', owner);
    assert.equal(res.status, 200);
    assert.equal(typeof res.json().ok, 'boolean');
    assert.equal(typeof res.json().message, 'string');
    assert.equal(res.text.includes(TOKEN), false);
    const missing = await api.request('POST', '/api/plugins/sync-github/actions/nothing', owner);
    assert.equal(missing.status, 404);
  });
});

describe('끄기와 없는 플러그인', () => {
  test('끄면 공개 설정이 404, 오류 모양은 { code, message }', async () => {
    await api.request('POST', '/api/plugins/comments-giscus/disable', owner);
    await api.request('POST', '/api/plugins/sync-github/disable', owner);
    const res = await api.get('/api/plugins/comments-giscus/settings');
    assert.equal(res.status, 404);
    assert.deepEqual(res.json(), {
      code: 'not_found',
      message: '켜진 플러그인 중에 comments-giscus이(가) 없어요',
    });
  });

  test('들어 있지 않은 플러그인도 404', async () => {
    const res = await api.get('/api/plugins/nothing-here/settings');
    assert.equal(res.status, 404);
    assert.equal(res.json().code, 'not_found');
  });
});
