import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient } from '../../../testing/api-client';

// 바깥에서 GET으로 닿는 서버의 모든 경로를 방문자로 불러, 응답 코드를 아래 표와 비교한다.
// 새 GET 경로가 생기거나 방문자에게 열리고 닫히는 것이 바뀌면 깨진다. 의도한 변경이면 표를 고치고 리뷰에서 본다.
// 경로의 :자리는 없는 값으로 채운다 (없는 것 → 404, 주인 전용 → 401 · 403). 사이트 주소는 이 서버로 정해 둔다.
// 같은 표를 write 권한 기기 토큰으로도 확인한다: AI 토큰은 /mcp에서만 요청자가 되어 REST에서는 방문자와 같다.

/** 방문자가 부른 결과. 열림(2xx · 없는 것 404)과 막힘(400 · 401 · 403 · 422)을 무리로 나눠 적는다 */
const VISITOR_GET: Readonly<Record<string, number>> = {
  // 방문자에게 열림: 공개 글 · 그래프 · 카테고리 · 위키, 사이트 정보, 설치 상태, 로그인 방법, 상태 확인
  'GET /api/auth/methods': 200,
  'GET /api/categories': 200,
  'GET /api/graph/public': 200,
  'GET /api/health': 200,
  'GET /api/install': 200,
  // 기능 패키지의 입구: 없는 패키지 · 경로는 404, 동작마다 권한은 패키지의 allow (package.api.test.ts)
  'GET /api/p/:plugin/*rest': 404,
  'GET /api/pages': 200,
  'GET /api/pages/site/*path': 404,
  'GET /api/plugins': 200,
  'GET /api/posts': 200,
  'GET /api/space': 200,
  // 사이트 로고: 누구나 보지만 올린 적이 없으면 404
  'GET /api/space/logo': 404,
  'GET /api/wikis': 200,
  'GET /api/files/:hash': 404,
  'GET /api/plugins/:name/settings': 404,
  'GET /api/posts/by-slug/:slug': 404,
  'GET /api/wikis/:id': 404,
  // AI 도구 연결: OAuth 안내 문서와 승인 시작
  'GET /.well-known/oauth-authorization-server': 200,
  'GET /.well-known/oauth-protected-resource': 200,
  'GET /.well-known/oauth-protected-resource/mcp': 200,
  'GET /oauth/authorize': 400,
  'GET /mcp': 401,
  // 로그인 흐름: 없는 방법은 404, 돌아오는 주소는 확인값이 없으면 400
  'GET /api/auth/links/:method/start': 404,
  'GET /api/auth/login/:method/start': 404,
  'GET /api/auth/login/:method/callback': 400,
  'GET /api/connect': 400,
  // 주인만
  'GET /api/auth/me': 401,
  'GET /api/agents': 403,
  'GET /api/agent-teams': 403,
  'GET /api/agents/:id/revisions': 403,
  'GET /api/ai': 403,
  'GET /api/approvals': 403,
  'GET /api/approvals/:id': 403,
  'GET /api/archive.zip': 403,
  'GET /api/auth/links': 403,
  'GET /api/basket/items': 403,
  'GET /api/changes': 403,
  'GET /api/devices': 403,
  'GET /api/goals': 403,
  'GET /api/goal-runs': 403,
  'GET /api/goal-runs/:id': 403,
  'GET /api/graph': 403,
  'GET /api/notice-settings': 403,
  'GET /api/notifications': 403,
  'GET /api/outputs': 403,
  'GET /api/outputs/download': 403,
  'GET /api/outputs/:id/file': 403,
  'GET /api/posts/:id': 403,
  'GET /api/push/key': 403,
  'GET /api/runner-skills': 403,
  'GET /api/runner-skills/:name': 403,
  'GET /api/runner-skills/:name/revisions/:revision': 403,
  'GET /api/runners': 403,
  'GET /api/pages/:id': 403,
  'GET /api/schedules': 403,
  'GET /api/sessions': 403,
  'GET /api/sessions/:id': 403,
  'GET /api/sessions/:id/revisions/:seq': 403,
  'GET /api/skills/:file': 403,
  'GET /api/stream': 403,
  'GET /api/tasks': 403,
  'GET /api/tasks/:id': 403,
  'GET /api/tidy/settings': 403,
  'GET /api/usage': 403,
  'GET /api/wikis/trash': 403,
  'GET /api/wiki-scores': 403,
  'GET /api/wiki-scores/:id': 403,
};

/** 경로의 :자리를 채울 값. 모두 없는 것이다 (skill 파일만 실제 이름: 있어도 방문자에게는 닫혀 있어야 한다) */
const FILL: Readonly<Record<string, string>> = {
  id: '01a1a000-0000-7000-8000-000000000000',
  seq: '1',
  hash: 'a'.repeat(64),
  slug: 'no-such-post',
  name: 'no-such-plugin',
  method: 'no-such-login',
  file: 'cairn-save.zip',
};

let api: ApiClient;
let writer: string;

before(async () => {
  api = await ApiClient.start();
  const owner = await api.signIn();
  writer = await api.writeDevice(owner, 'surface-writer');
});
after(() => api.close());

/** 그 경로를 GET으로 불러 응답 코드만 본다. 실시간 경로가 열려 버리면 오래 붙잡지 않게 4초로 끊는다 */
async function statusOf(route: string, headers: Record<string, string> = {}): Promise<number> {
  const path = route.slice('GET '.length).replace(/:(\w+)/g, (_, key: string) => FILL[key] ?? 'x');
  const res = await fetch(`${api.baseUrl}${path}`, {
    redirect: 'manual',
    headers,
    signal: AbortSignal.timeout(4000),
  });
  await res.body?.cancel();
  return res.status;
}

async function surface(headers: Record<string, string> = {}): Promise<Record<string, number>> {
  const found: Record<string, number> = {};
  for (const route of api.routes().filter((r) => r.startsWith('GET ')))
    found[route] = await statusOf(route, headers);
  return found;
}

describe('바깥에서 GET으로 닿는 경로', () => {
  test('방문자가 부른 결과가 표와 같다 (새 경로나 열림 · 막힘의 변화는 표를 고쳐야 통과한다)', async () => {
    assert.deepEqual(await surface(), VISITOR_GET);
  });

  test('write 권한 기기 토큰도 REST에서는 방문자와 같은 결과를 받는다', async () => {
    const found = await surface({ authorization: `Bearer ${writer}` });
    // /mcp에서만 기기 토큰이 요청자가 된다. 그래서 그 경로만 방문자의 401과 다르다
    const { 'GET /mcp': mcp, ...rest } = found;
    const { 'GET /mcp': _visitorMcp, ...visitorRest } = VISITOR_GET;
    assert.deepEqual(rest, visitorRest);
    assert.notEqual(mcp, 401, '/mcp에서는 기기 토큰이 요청자가 된다');
  });
});
