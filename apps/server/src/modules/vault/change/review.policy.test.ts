import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Category } from '../category/category';
import { Edge, EdgeKind } from '../edge/edge';
import { type LoadedSession, Session } from '../session/session';
import { Wiki } from '../wiki/wiki';
import { WikiBody } from '../wiki/wiki-body';
import {
  CategoryAssignOp,
  CategoryCreateOp,
  type ChangeOp,
  EdgeAddOp,
  EdgeRemoveOp,
  SessionAssignOp,
  TargetBoard,
  WikiCreateOp,
  WikiReviseOp,
} from './change-op';
import { type ChangeTarget, ChangeWork } from './change-target';
import { ReviewPolicy, ReviewRules, Verdict } from './review.policy';

// 변경마다의 판정 (DB 없이). 기본값은 승인된 표대로, 사람이 정한 것은 주인이 값을 바꿔도 AI가 덮지 못한다.

const NOW = new Date('2026-11-01T00:00:00Z');
const SPACE = '0192d2a0-0000-7000-8000-000000000001';
const SESSION_ID = '0192d2a0-0000-7000-8000-000000000002';
const NODE_A = '0192d2a0-0000-7000-8000-00000000000a';
const NODE_B = '0192d2a0-0000-7000-8000-00000000000b';
const ai = new ChangeWork(SPACE, 'set', 'ai', null, NOW, false);
const human = new ChangeWork(SPACE, 'set', 'user', NODE_A, NOW, false);
const policy = new ReviewPolicy();
const KINDS = new Map([
  ['link', new EdgeKind('link', false, true)],
  ['material', new EdgeKind('material', true, true)],
  ['locked', new EdgeKind('locked', true, false)],
]);
const defaults = new ReviewRules(new Map(), new Map(), 1);

/** 대상을 잠근 것처럼 놓은 판 */
function board(...targets: readonly (readonly [string, ChangeTarget])[]): TargetBoard {
  const on = new TargetBoard(KINDS);
  for (const [place, target] of targets) on.put(place, target);
  on.markLive(new Set([NODE_A, NODE_B]));
  return on;
}

function judge(op: ChangeOp, on: TargetBoard, rules = defaults): Verdict {
  op.bind(on);
  return policy.judge(op, op.target, rules);
}

function session(wikiId: string | null, pinned: readonly string[] = []): Session {
  return Session.restore({
    id: SESSION_ID,
    node_id: SESSION_ID,
    version: 3,
    space_id: SPACE,
    wiki_id: wikiId,
    pinned_sections: pinned,
  } as LoadedSession);
}

const wikiOf = (by: ChangeWork, md: string): Wiki =>
  Wiki.open(by, '정리', WikiBody.parse(md), null, null);

const edgePlace = TargetBoard.place('edge', `${NODE_A}:${NODE_B}:link`);

function revise(wiki: Wiki, md: string, title: string | null = null): Verdict {
  const op = new WikiReviseOp(1, wiki.id, null, title, WikiBody.parse(md), null);
  return judge(op, board([TargetBoard.place('wiki', wiki.id), wiki]));
}

describe('wiki', () => {
  test('wiki.create는 바로 합친다', () => {
    const op = new WikiCreateOp(1, null, '새 문서', WikiBody.parse('본문'), null, null, null);
    assert.equal(judge(op, board()).action, Verdict.MERGE);
    assert.equal(judge(op, board()).rule, 'add');
  });

  test('AI가 만든 칸을 고치면 바로 합친다', () => {
    const verdict = revise(wikiOf(ai, '## 배경\n\n처음'), '## 배경\n\n고침');
    assert.deepEqual([verdict.action, verdict.rule], [Verdict.MERGE, 'edit_own']);
  });

  test('사람이 고친 칸을 건드리면 검토, 다른 칸만 고치면 바로 합친다', () => {
    const wiki = wikiOf(ai, '## 배경\n\nAI\n\n## 결론\n\nAI');
    wiki.revise(wiki.title, WikiBody.parse('## 배경\n\n사람\n\n## 결론\n\nAI'), human);
    assert.deepEqual(wiki.unsaved.pinned_sections, ['배경']);

    const touched = revise(wiki, '## 배경\n\n덮어쓰기\n\n## 결론\n\nAI');
    assert.deepEqual([touched.action, touched.rule], [Verdict.REVIEW, 'human_owned']);
    assert.match(String(touched.reason), /사람이 정한/);

    const other = revise(wiki, '## 배경\n\n사람\n\n## 결론\n\n더 고침');
    assert.deepEqual([other.action, other.rule], [Verdict.MERGE, 'edit_own']);
  });

  test('사람이 고친 칸을 지워도 검토다', () => {
    const wiki = wikiOf(ai, '## 배경\n\nAI');
    wiki.revise(wiki.title, WikiBody.parse('## 배경\n\n사람'), human);
    assert.equal(revise(wiki, '다른 글').action, Verdict.REVIEW);
  });

  test('사람이 만든 wiki는 처음부터 사람의 것이다 (제목 포함)', () => {
    const wiki = wikiOf(human, '## 배경\n\n사람');
    assert.equal(revise(wiki, '## 배경\n\nAI').action, Verdict.REVIEW);
    assert.equal(revise(wiki, '## 배경\n\n사람', '새 제목').action, Verdict.REVIEW);
    assert.equal(revise(wiki, '## 배경\n\n사람\n\n## 덧붙임\n\nAI').action, Verdict.MERGE);
  });

  test('AI는 공개 여부를 정할 수 없다: 주인이 값을 바꿔도 거부', () => {
    const open = new ReviewRules(new Map([['publish', Verdict.MERGE]]), new Map(), 1);
    const create = new WikiCreateOp(
      1,
      null,
      '새 문서',
      WikiBody.parse('본문'),
      null,
      null,
      'public',
    );
    assert.equal(judge(create, board(), open).action, Verdict.REJECT);
    const wiki = wikiOf(ai, '본문');
    const op = new WikiReviseOp(1, wiki.id, null, null, WikiBody.parse('본문'), 'public');
    const verdict = judge(op, board([TargetBoard.place('wiki', wiki.id), wiki]), open);
    assert.deepEqual([verdict.action, verdict.rule], [Verdict.REJECT, 'publish']);
  });

  test('AI가 본 version과 다르면 검토, 없는 wiki면 거부', () => {
    const wiki = wikiOf(ai, '본문');
    const stale = new WikiReviseOp(1, wiki.id, 7, null, WikiBody.parse('고침'), null);
    const verdict = judge(stale, board([TargetBoard.place('wiki', wiki.id), wiki]));
    assert.deepEqual([verdict.action, verdict.rule], [Verdict.REVIEW, 'stale']);
    const gone = new WikiReviseOp(1, NODE_A, null, null, WikiBody.parse('고침'), null);
    assert.deepEqual(
      [judge(gone, board()).action, judge(gone, board()).rule],
      [Verdict.REJECT, 'missing'],
    );
  });
});

describe('세션의 대표 wiki', () => {
  const wiki = wikiOf(ai, '본문');
  const verdict = (target: Session): Verdict =>
    judge(
      new SessionAssignOp(1, SESSION_ID, null, wiki.id),
      board(
        [TargetBoard.place('session', SESSION_ID), target],
        [TargetBoard.place('wiki', wiki.id), wiki],
      ),
    );

  test('비어 있으면 바로 합친다', () => {
    assert.deepEqual(
      [verdict(session(null)).action, verdict(session(null)).rule],
      [Verdict.MERGE, 'add'],
    );
  });

  test('AI가 정한 것은 바로 합친다', () => {
    assert.equal(verdict(session(NODE_A)).action, Verdict.MERGE);
  });

  test('사람이 정했으면 검토 (사람이 비웠어도)', () => {
    assert.equal(verdict(session(NODE_A, [Session.WIKI_KEY])).action, Verdict.REVIEW);
    assert.equal(verdict(session(null, [Session.WIKI_KEY])).action, Verdict.REVIEW);
  });

  test('가리킨 wiki가 없으면 거부', () => {
    const op = new SessionAssignOp(1, SESSION_ID, null, NODE_B);
    const on = board([TargetBoard.place('session', SESSION_ID), session(null)]);
    assert.deepEqual([judge(op, on).action, judge(op, on).rule], [Verdict.REJECT, 'missing']);
  });
});

describe('연결', () => {
  const add = () => new EdgeAddOp(1, null, NODE_B, NODE_A, 'link', false);
  const remove = () => new EdgeRemoveOp(1, null, NODE_B, NODE_A, 'link');

  test('edge.add는 바로 합친다. 방향 없는 선은 작은 id가 앞이다', () => {
    const op = add();
    const on = board();
    assert.deepEqual(op.places(on), [edgePlace]);
    assert.equal(judge(op, on).action, Verdict.MERGE);
    const edge = op.apply(ai) as Edge;
    assert.deepEqual([edge.unsaved.src, edge.unsaved.dst], [NODE_A, NODE_B]);
  });

  test('사람이 지운 선을 다시 만들면 거부', () => {
    const edge = Edge.open(ai, NODE_A, NODE_B, 'link');
    edge.remove(human);
    const verdict = judge(add(), board([edgePlace, edge]));
    assert.deepEqual([verdict.action, verdict.rule], [Verdict.REJECT, 'human_deleted']);
  });

  test('AI가 지운 선은 다시 만들 수 있다', () => {
    const edge = Edge.open(ai, NODE_A, NODE_B, 'link');
    edge.remove(ai);
    assert.equal(judge(add(), board([edgePlace, edge])).action, Verdict.MERGE);
  });

  test('사람이 만든 선을 지우려 하면 검토, AI가 만든 선은 바로 합친다', () => {
    const mine = Edge.open(human, NODE_A, NODE_B, 'link');
    const verdict = judge(remove(), board([edgePlace, mine]));
    assert.deepEqual([verdict.action, verdict.rule], [Verdict.REVIEW, 'human_owned']);
    const theirs = Edge.open(ai, NODE_A, NODE_B, 'link');
    const merged = judge(remove(), board([edgePlace, theirs]));
    assert.deepEqual([merged.action, merged.rule], [Verdict.MERGE, 'edit_own']);
  });

  test('없는 선을 지우거나, 없는 점·없는 종류·AI가 못 만드는 종류는 거부', () => {
    assert.equal(judge(remove(), board()).action, Verdict.REJECT);
    const noNode = new EdgeAddOp(1, null, NODE_A, SESSION_ID, 'link', false);
    assert.equal(judge(noNode, board()).action, Verdict.REJECT);
    const noKind = new EdgeAddOp(1, null, NODE_A, NODE_B, 'nothing', false);
    assert.equal(judge(noKind, board()).action, Verdict.REJECT);
    const locked = new EdgeAddOp(1, null, NODE_A, NODE_B, 'locked', false);
    assert.equal(judge(locked, board()).action, Verdict.REJECT);
  });
});

describe('카테고리', () => {
  test('category.create는 검토', () => {
    const op = new CategoryCreateOp(1, null, { name: '새 구역', sort: 0 });
    const verdict = judge(op, board());
    assert.deepEqual([verdict.action, verdict.rule], [Verdict.REVIEW, 'structure']);
  });

  test('category.assign은 검토', () => {
    const wiki = wikiOf(ai, '본문');
    const category = Category.open(human, { name: '구역', sort: 0 });
    const op = new CategoryAssignOp(1, wiki.id, null, category.id);
    const verdict = judge(
      op,
      board(
        [TargetBoard.place('wiki', wiki.id), wiki],
        [TargetBoard.place('category', category.id), category],
      ),
    );
    assert.deepEqual([verdict.action, verdict.rule], [Verdict.REVIEW, 'structure']);
  });
});

describe('규칙 값', () => {
  const create = () =>
    new WikiCreateOp(1, null, '새 문서', WikiBody.parse('본문'), null, null, null);

  test('대상이 50개 이상인 묶음은 검토, 49개는 그대로', () => {
    const many = new ReviewRules(new Map(), new Map(), 50);
    const verdict = judge(create(), board(), many);
    assert.deepEqual([verdict.action, verdict.rule], [Verdict.REVIEW, 'large_set']);
    const fewer = new ReviewRules(new Map(), new Map(), 49);
    assert.equal(judge(create(), board(), fewer).action, Verdict.MERGE);
  });

  test('큰 묶음의 기준은 주인이 바꾼다', () => {
    const lower = new ReviewRules(new Map(), new Map([['large_set', 3]]), 3);
    assert.equal(judge(create(), board(), lower).action, Verdict.REVIEW);
  });

  test('행이 있으면 그 값을 쓴다', () => {
    const strict = new ReviewRules(new Map([['add', Verdict.REVIEW]]), new Map(), 1);
    assert.equal(judge(create(), board(), strict).action, Verdict.REVIEW);
    const reject = new ReviewRules(new Map([['add', Verdict.REJECT]]), new Map(), 1);
    assert.equal(judge(create(), board(), reject).action, Verdict.REJECT);
  });

  test('사람이 정한 것은 주인이 값을 merge로 바꿔도 AI가 덮지 못한다', () => {
    const loose = new ReviewRules(
      new Map([
        ['human_owned', Verdict.MERGE],
        ['human_deleted', Verdict.MERGE],
      ]),
      new Map(),
      1,
    );
    const wiki = wikiOf(human, '## 배경\n\n사람');
    const op = new WikiReviseOp(1, wiki.id, null, null, WikiBody.parse('## 배경\n\nAI'), null);
    assert.equal(
      judge(op, board([TargetBoard.place('wiki', wiki.id), wiki]), loose).action,
      Verdict.REVIEW,
    );
    const edge = Edge.open(ai, NODE_A, NODE_B, 'link');
    edge.remove(human);
    const revive = new EdgeAddOp(1, null, NODE_A, NODE_B, 'link', false);
    assert.equal(judge(revive, board([edgePlace, edge]), loose).action, Verdict.REVIEW);
  });

  test('걸린 규칙 중 가장 엄한 것이 판정이다', () => {
    const many = new ReviewRules(new Map(), new Map(), 60);
    const edge = Edge.open(ai, NODE_A, NODE_B, 'link');
    edge.remove(human);
    const revive = new EdgeAddOp(1, null, NODE_A, NODE_B, 'link', false);
    assert.equal(judge(revive, board([edgePlace, edge]), many).action, Verdict.REJECT);
  });
});
