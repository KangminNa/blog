import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type StaleCandidateRow, StaleWikis } from './stale-wikis';

// 지울 만한 wiki 알림 기록: 새로 후보가 된 wiki만 알리고, 빠진 wiki는 기록을 지운다 (DB 없이).

const SPACE = '0192d2a0-0000-7000-8000-000000000001';
const A = '0192d2a0-0000-7000-8000-00000000000a';
const B = '0192d2a0-0000-7000-8000-00000000000b';
const C = '0192d2a0-0000-7000-8000-00000000000c';
const row = (wiki_id: string, title: string): StaleCandidateRow => ({ wiki_id, title, score: 0.1 });

describe('지울 만한 wiki 알림 기록', () => {
  test('처음 후보가 된 wiki만 알리고 기록한다', () => {
    const stale = StaleWikis.restore({ id: SPACE, wiki_ids: [A] });
    stale.settle([row(A, '옛 메모'), row(B, '배포 메모')]);
    assert.equal(stale.noticedNow, 1);
    assert.deepEqual(
      stale.newRows.map((r) => r.wiki_id),
      [B],
    );
    const notice = stale.notice();
    assert.equal(notice?.title, '지울 만한 위키 2개');
    assert.match(String(notice?.body), /배포 메모/);
    assert.doesNotMatch(String(notice?.body), /옛 메모/);
    assert.equal(notice?.group_key, 'vault.wiki.stale');
    assert.equal(notice?.link, '/admin/wiki?view=stale');
    assert.deepEqual(notice?.data, { wikiIds: [B], total: 2 });
  });

  test('이미 알린 wiki뿐이면 알리지 않는다 (두 번 돌아도 같다)', () => {
    const stale = StaleWikis.restore({ id: SPACE, wiki_ids: [A, B] });
    stale.settle([row(A, '옛 메모'), row(B, '배포 메모')]);
    assert.equal(stale.noticedNow, 0);
    assert.equal(stale.notice(), null);
    assert.deepEqual(stale.goneIds, []);
  });

  test('후보에서 빠진 wiki는 기록을 지워, 다시 내려가면 또 알린다', () => {
    const stale = StaleWikis.restore({ id: SPACE, wiki_ids: [A, C] });
    stale.settle([row(A, '옛 메모')]);
    assert.deepEqual(stale.goneIds, [C]);
    assert.equal(stale.notice(), null);
  });

  test('많으면 제목은 다섯 개까지 적는다', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      row(`0192d2a0-0000-7000-8000-00000000010${i}`, `메모 ${i}`),
    );
    const stale = StaleWikis.restore({ id: SPACE, wiki_ids: [] });
    stale.settle(many);
    assert.match(String(stale.notice()?.body), /메모 4 외 2개/);
  });
});
