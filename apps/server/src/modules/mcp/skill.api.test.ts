import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { ApiClient, type TestUser } from '../../testing/api-client';

// 관리 화면 기기 시트의 "스킬 받기": ChatGPT·Claude 앱에 올릴 스킬 zip.

let api: ApiClient;
let owner: TestUser;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
});
after(() => api.close());

/** zip의 파일들을 읽는다 (지역 머리글을 차례로) */
function unzip(zip: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extra = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extra;
    files.set(name, inflateRawSync(zip.subarray(start, start + size)).toString('utf8'));
    at = start + size;
  }
  return files;
}

function download(path: string, as?: TestUser): Promise<Response> {
  return fetch(`${api.baseUrl}${path}`, { headers: as ? { cookie: as.header } : {} });
}

describe('앱에 올릴 스킬 묶음', () => {
  test('방문자는 받을 수 없다', async () => {
    assert.equal((await download('/api/skills/cairn-save.zip')).status, 403);
  });

  test('주인은 SKILL.md와 references만 든 zip을 받는다 (스크립트·검토자 정의는 빠짐)', async () => {
    const res = await download('/api/skills/cairn-save.zip', owner);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition') ?? '', /filename="cairn-save\.zip"/);
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    const names = [...files.keys()];
    assert.ok(names.includes('cairn-save/SKILL.md'));
    assert.ok(names.includes('cairn-save/references/note-rules.md'));
    assert.ok(names.every((n) => !n.includes('/scripts/') && !n.includes('/agents/')));
    const skill = files.get('cairn-save/SKILL.md') ?? '';
    assert.match(skill, /^---\nname: cairn-save\n/);
    assert.ok(!skill.includes('{{SKILL_DIR}}'));
    assert.ok(!skill.includes('allowed-tools'));
  });

  test('없는 스킬이나 zip이 아닌 이름은 404', async () => {
    assert.equal((await download('/api/skills/nothing.zip', owner)).status, 404);
    assert.equal((await download('/api/skills/cairn-save', owner)).status, 404);
    assert.equal((await download('/api/skills/..%2Fdb.zip', owner)).status, 404);
  });
});
