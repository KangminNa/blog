import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

// GET /health: 서버·DB 연결, 확장, 적용된 마이그레이션, 모듈 스키마별 테이블 수.
// 누구나 status를 받고, 자세한 내용(버전을 짐작할 단서)은 주인에게만.

let api: ApiClient;
let owner: TestUser;
before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
});
after(() => api.close());

describe('GET /health', () => {
  test('방문자와 기기 토큰은 status만 받는다 (상태 확인은 응답 코드만 본다)', async () => {
    const visitor = await api.get('/api/health');
    assert.equal(visitor.status, 200);
    assert.deepEqual(visitor.json(), { status: 'ok' });

    const writer = await api.writeDevice(owner, 'health-writer');
    const asDevice = await api.request('GET', '/api/health', TestUser.visitor, undefined, {
      authorization: `Bearer ${writer}`,
    });
    assert.deepEqual(asDevice.json(), { status: 'ok' }, '기기 토큰은 REST에서 방문자와 같다');
  });

  test('주인: DB 확장 세 개와 모든 마이그레이션이 적용된 상태를 돌려준다', async () => {
    const res = await api.get('/api/health', owner);
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.deepEqual(Object.keys(body.extensions as object).sort(), [
      'pg_bigm',
      'pgcrypto',
      'vector',
    ]);

    // 코어(db/migrations)와 기능 패키지(plugins/<이름>/migrations)의 마이그레이션
    const root = resolve(process.cwd(), '../..');
    const dirs = [
      join(root, 'db/migrations'),
      ...readdirSync(join(root, 'plugins'))
        .map((name) => join(root, 'plugins', name, 'migrations'))
        .filter((dir) => existsSync(dir)),
    ];
    const files = dirs
      .flatMap((dir) => readdirSync(dir))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.slice(0, 14))
      .sort();
    assert.deepEqual(body.migrations, files, '마이그레이션 파일이 모두 적용되어 있어야 한다');
  });

  test('주인: 모듈 스키마마다 테이블이 있다', async () => {
    const tables = (await api.get('/api/health', owner)).json().tables as Record<string, number>;
    for (const schema of ['platform', 'account', 'vault', 'blog', 'work', 'mcp']) {
      assert.ok((tables[schema] ?? 0) > 0, `${schema} 스키마에 테이블이 없다`);
    }
  });
});
