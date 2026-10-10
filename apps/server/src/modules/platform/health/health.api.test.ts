import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ApiClient } from '../../../testing/api-client';

// GET /health: 서버·DB 연결, 확장, 적용된 마이그레이션, 모듈 스키마별 테이블 수

let api: ApiClient;
before(async () => {
  api = await ApiClient.start();
});
after(() => api.close());

describe('GET /health', () => {
  test('DB 확장 세 개와 모든 마이그레이션이 적용된 상태를 돌려준다', async () => {
    const res = await api.get('/health');
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.deepEqual(Object.keys(body.extensions as object).sort(), [
      'pg_bigm',
      'pgcrypto',
      'vector',
    ]);

    const files = readdirSync(resolve(process.cwd(), '../../db/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.slice(0, 14))
      .sort();
    assert.deepEqual(body.migrations, files, '마이그레이션 파일이 모두 적용되어 있어야 한다');
  });

  test('모듈 스키마마다 테이블이 있다', async () => {
    const tables = (await api.get('/health')).json().tables as Record<string, number>;
    for (const schema of ['platform', 'account', 'vault', 'blog', 'work', 'mcp']) {
      assert.ok((tables[schema] ?? 0) > 0, `${schema} 스키마에 테이블이 없다`);
    }
  });
});
