import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { AgentUser } from './agent-user';
import { OutputBatch } from './output-batch';

// 결과물로 올릴 파일 모으기 (디스크만, 서버 없이).

const root = mkdtempSync(join(tmpdir(), 'cairn-output-batch-'));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

after(() => rmSync(root, { recursive: true, force: true }));

function folder(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, '보고서.md'), '# 보고서');
  writeFileSync(join(dir, 'a.txt'), 'A');
  writeFileSync(join(dir, '.env'), 'SECRET=1');
  writeFileSync(join(dir, 'empty.txt'), '');
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'inner.txt'), '폴더 안');
  writeFileSync(join(root, `${name}-outside.txt`), '밖의 파일');
  symlinkSync(join(root, `${name}-outside.txt`), join(dir, 'link.txt'));
  return dir;
}

describe('OutputBatch', () => {
  test('폴더 바로 아래의 보통 파일만, 이름 순으로. 숨김 · 빈 파일 · 폴더 · 링크는 이유와 함께 뺀다', async () => {
    const batch = await OutputBatch.collect(folder('plain'), null, null);
    assert.deepEqual(
      batch.files.map((f) => [f.name, f.size, f.sha256]),
      [
        ['a.txt', 1, sha('A')],
        ['보고서.md', Buffer.byteLength('# 보고서'), sha('# 보고서')],
      ],
    );
    const skipped = batch.skipped.join('\n');
    for (const name of ['.env', 'empty.txt', 'nested', 'link.txt'])
      assert.match(skipped, new RegExp(name));
  });

  test('코드 러너 칸: agent 권한으로 러너만의 폴더에 옮긴 사본을 올린다', async () => {
    const stage = join(root, 'stage');
    const agent = AgentUser.parse('self');
    assert.ok(agent);
    const batch = await OutputBatch.collect(folder('room'), stage, agent);
    assert.deepEqual(
      batch.files.map((f) => f.name),
      ['a.txt', '보고서.md'],
    );
    for (const file of batch.files) assert.ok(file.path.startsWith(stage), file.path);
    assert.equal(batch.files[1]?.sha256, sha('# 보고서'));
  });

  test('없는 폴더는 빈 묶음', async () => {
    const batch = await OutputBatch.collect(join(root, 'none'), null, null);
    assert.deepEqual([batch.files.length, batch.skipped.length], [0, 0]);
  });

  test('이름 규칙은 서버와 같다', () => {
    assert.equal(OutputBatch.nameProblem('보고서 최종.pptx'), null);
    for (const name of ['.hidden', ' a', 'a ', 'a\tb', 'x'.repeat(121)])
      assert.notEqual(OutputBatch.nameProblem(name), null, JSON.stringify(name));
  });
});
