import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type ScoredWikiRow,
  type WikiCiteRow,
  type WikiScore,
  WikiScorePolicy,
  type WikiUseRow,
} from './wiki-score.policy';

// docs/wiki점수.md의 계산 예를 그대로 다시 계산한다 (식이 문서와 같은지 보는 검사).
// H = 90일, 오늘 t = 180일, β = ½. A는 0일, B는 90일, C는 180일(오늘)에 만들었다.

const DAY = 86_400_000;
const ORIGIN = Date.parse('2026-01-01T00:00:00Z');
const day = (n: number) => new Date(ORIGIN + n * DAY);
// id는 UUIDv7처럼 만든 순서대로 커진다
const A = '0192d2a0-0000-7000-8000-00000000000a';
const B = '0192d2a0-0000-7000-8000-00000000000b';
const C = '0192d2a0-0000-7000-8000-00000000000c';
const D = '0192d2a0-0000-7000-8000-00000000000d';
const E = '0192d2a0-0000-7000-8000-00000000000e';

const wiki = (id: string, created: number): ScoredWikiRow => ({
  node_id: id,
  created_at: day(created),
});
const link = (src: string, dst: string, at: number): WikiCiteRow => ({
  src,
  dst,
  kind: 'link',
  created_at: day(at),
});
const replaces = (src: string, dst: string, at: number): WikiCiteRow => ({
  src,
  dst,
  kind: 'replaces',
  created_at: day(at),
});

const ABC = [wiki(A, 0), wiki(B, 90), wiki(C, 180)];
/** B는 A를, C는 A와 B를 근거로 삼았다 (근거가 생긴 날 = 근거로 삼은 wiki를 만든 날) */
const ABC_LINKS = [link(B, A, 90), link(C, A, 180), link(C, B, 180)];

function scores(
  today: number,
  wikis: readonly ScoredWikiRow[],
  cites: readonly WikiCiteRow[],
  uses: readonly WikiUseRow[] = [],
  cited?: number,
): Map<string, WikiScore> {
  const result = new WikiScorePolicy(day(today), cited).score(wikis, uses, cites);
  return new Map(result.map((s) => [s.wikiId, s]));
}

function near(actual: number | undefined, expected: number, label: string): void {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-9,
    `${label}: ${actual} ≠ ${expected}`,
  );
}

describe('wiki 점수: 문서의 계산 예', () => {
  test('A · B · C의 쌓인 점수 · 물려받은 점수 · 최종 점수와 순위', () => {
    const s = scores(180, ABC, ABC_LINKS);
    near(s.get(A)?.accumulated, 1.75, 'A_A');
    near(s.get(B)?.accumulated, 1.5, 'A_B');
    near(s.get(C)?.accumulated, 1, 'A_C');
    near(s.get(A)?.inherited, 0, 'A 물려받음');
    near(s.get(B)?.inherited, 0.625, 'B 물려받음');
    near(s.get(C)?.inherited, 0.625, 'C 물려받음 (A 0.375 + B 0.25)');
    near(s.get(B)?.total, 2.125, 'S_B');
    near(s.get(A)?.total, 1.75, 'S_A');
    near(s.get(C)?.total, 1.625, 'S_C');
    const amounts = new Map(s.get(C)?.bases.map((b) => [b.wikiId, b.amount]));
    near(amounts.get(A), 0.375, 'C가 A에게서');
    near(amounts.get(B), 0.25, 'C가 B에게서');
    const ranked = [...s.values()].sort((x, y) => x.total - y.total).reverse();
    assert.deepEqual(
      ranked.map((x) => x.wikiId),
      [B, A, C],
    );
  });

  test('β를 바꾸면: 0이면 혼자 쓴 문서와 같고, 1이면 아직 아무도 쓰지 않은 C가 기반 A를 앞지른다', () => {
    for (const [beta, b, c] of [
      [0, 1.5, 1],
      [0.5, 2.125, 1.625],
      [1, 2.75, 2.25],
    ] as const) {
      const s = scores(180, ABC, ABC_LINKS, [], beta);
      near(s.get(B)?.total, b, `β=${beta} B`);
      near(s.get(C)?.total, c, `β=${beta} C`);
    }
  });

  test('C가 B를 대체하면 B를 전부 물려받고 B는 히스토리가 된다', () => {
    const s = scores(180, ABC, [...ABC_LINKS, replaces(C, B, 180)]);
    near(s.get(C)?.total, 1.875, 'S_C');
    near(s.get(A)?.total, 1.75, 'S_A');
    near(s.get(B)?.accumulated, 1.5, '링크와 대체가 함께 있어도 근거는 하나');
    assert.equal(s.get(B)?.replacedBy, C);
    assert.equal(s.get(B)?.history, true);
    assert.equal(s.get(C)?.history, false);
  });

  test('히스토리가 된 B를 딛고 있던 다른 wiki는 B에게서 물려받지 않는다', () => {
    const s = scores(
      180,
      [...ABC, wiki(E, 180)],
      [...ABC_LINKS, replaces(C, B, 180), link(E, B, 180)],
    );
    const fromB = s.get(E)?.bases.find((b) => b.wikiId === B);
    assert.equal(fromB?.gone, true);
    near(fromB?.amount, 0, 'E가 B에게서');
    near(s.get(E)?.total, 1, 'S_E');
  });

  test('오늘 D가 A를 근거로 삼으면 A가 살아나고, A를 딛고 있던 B · C도 함께 오른다', () => {
    const s = scores(180, [...ABC, wiki(D, 180)], [...ABC_LINKS, link(D, A, 180)]);
    near(s.get(A)?.total, 2.75, 'S_A');
    near(s.get(B)?.total, 2.625, 'S_B');
    near(s.get(C)?.total, 2.125, 'S_C');
    near(s.get(D)?.total, 1.875, 'S_D');
  });

  test('90일 뒤 새 문서가 없으면 모든 값이 절반이 되고 순위는 그대로다', () => {
    const s = scores(270, ABC, ABC_LINKS);
    near(s.get(B)?.total, 1.0625, 'S_B');
    near(s.get(A)?.total, 0.875, 'S_A');
    near(s.get(C)?.total, 0.8125, 'S_C');
  });
});

describe('wiki 점수: Cairn에서', () => {
  test('링크는 방향이 없다: 저장 순서와 상관없이 나중에 만든 wiki가 근거로 삼은 것', () => {
    const s = scores(180, ABC, [link(A, B, 90), link(A, C, 180), link(B, C, 180)]);
    near(s.get(B)?.total, 2.125, 'S_B');
    near(s.get(C)?.total, 1.625, 'S_C');
  });

  test('세션 · 글은 쓰임만 준다: 쓰인 날의 1점이 줄어든 값이 더해지고 마지막으로 쓰인 날이 바뀐다', () => {
    const s = scores(
      180,
      [wiki(A, 0)],
      [],
      [
        { wiki_id: A, at: day(90) },
        { wiki_id: A, at: day(180) },
      ],
    );
    near(s.get(A)?.total, 0.25 + 0.5 + 1, 'S_A');
    assert.equal(s.get(A)?.uses, 2);
    assert.equal(s.get(A)?.lastUsedAt.getTime(), day(180).getTime());
  });

  test('점수를 받지 않는 점(휴지통의 wiki · 카테고리)과 이은 선, 다른 종류의 선은 세지 않는다', () => {
    const gone = '0192d2a0-0000-7000-8000-0000000000ff';
    const s = scores(
      180,
      [wiki(A, 0), wiki(B, 90)],
      [link(gone, A, 90), { ...link(B, A, 90), kind: 'similar' }],
    );
    near(s.get(A)?.total, 0.25, 'S_A');
    assert.equal(s.get(A)?.uses, 0);
  });

  test('화면 점수는 가장 높은 점수를 100으로 둔다', () => {
    const s = scores(180, ABC, ABC_LINKS);
    const max = Math.max(...[...s.values()].map((x) => x.total));
    assert.equal(s.get(B)?.shown(max), 100);
    assert.equal(s.get(C)?.shown(max), 76);
    assert.equal(s.get(A)?.shown(0), 0);
  });

  test('아무도 쓰지 않은 wiki는 270일이 지나야 지울 만한 기준(0.125)에 닿는다', () => {
    near(scores(270, [wiki(A, 0)], []).get(A)?.total, WikiScorePolicy.STALE_BELOW, '270일');
    assert.ok((scores(269, [wiki(A, 0)], []).get(A)?.total ?? 0) > WikiScorePolicy.STALE_BELOW);
  });
});
