import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import { ChangeWork } from '../change/change-target';
import { Wiki } from './wiki';
import { WikiBody, WikiSection } from './wiki-body';

// wiki의 칸 나누기와 판 쌓기 (DB 없이). 칸은 ## 제목 단위이고 사람이 고친 곳을 AI가 덮지 않게 하는 단위다.

const NOW = new Date('2026-11-01T00:00:00Z');
const ai = new ChangeWork('space', 'set-1', 'ai', null, NOW, false);
const human = new ChangeWork('space', 'set-2', 'user', 'owner', NOW, false);

describe('WikiBody', () => {
  test('## 제목으로 칸을 나누고, 첫 제목 앞의 글은 따로 둔다', () => {
    const body = WikiBody.parse('머리말\n\n## 배경\n\n앞\n\n### 작은 제목\n\n## 결론\n뒤\n');
    assert.deepEqual(
      body.sections.map((s) => [s.key, s.title, s.body]),
      [
        [WikiSection.LEAD, '', '머리말'],
        ['배경', '배경', '앞\n\n### 작은 제목'],
        ['결론', '결론', '뒤'],
      ],
    );
  });

  test('코드 블록 안의 ##은 제목이 아니다', () => {
    const body = WikiBody.parse('## 예시\n\n```md\n## 제목 아님\n```\n\n~~~\n## 이것도\n~~~\n');
    assert.deepEqual(
      body.sections.map((s) => s.key),
      ['예시'],
    );
  });

  test('같은 제목은 뒤에 번호가 붙는다', () => {
    const body = WikiBody.parse('## 예\n\n하나\n\n## 예\n\n둘\n');
    assert.deepEqual(
      body.sections.map((s) => s.key),
      ['예', '예 2'],
    );
  });

  test('줄바꿈을 맞춘다', () => {
    assert.equal(WikiBody.parse('한\r\n둘\r셋').markdown, '한\n둘\n셋');
  });

  test('바뀐 칸: 고쳤거나 새로 생겼거나 없어진 칸', () => {
    const before = WikiBody.parse('## 가\n\n1\n\n## 나\n\n2\n\n## 다\n\n3');
    const after = WikiBody.parse('## 가\n\n1\n\n## 나\n\n고침\n\n## 라\n\n4');
    assert.deepEqual([...after.changedFrom(before)].sort(), ['나', '다', '라']);
  });
});

describe('Wiki', () => {
  const body = (md: string): WikiBody => WikiBody.parse(md);

  test('새 wiki는 비공개이고 첫 판이 쌓인다', () => {
    const wiki = Wiki.open(ai, ' 세션 저장 ', body('본문'), null, null);
    assert.equal(wiki.title, '세션 저장');
    assert.equal(wiki.slug, '세션-저장');
    assert.equal(wiki.visibility, Wiki.PRIVATE);
    assert.equal(wiki.origin, 'ai');
    assert.equal(wiki.revisionCount, 1);
    assert.equal(wiki.addedRevision?.kind, 'ai');
    assert.equal(wiki.addedRevision?.changeSetId, 'set-1');
    assert.deepEqual(wiki.pinnedSections, []);
  });

  test('글자가 없는 제목이나 긴 제목은 거절한다', () => {
    assert.throws(() => Wiki.open(ai, '   ', body('본문'), null, null), RuleViolation);
    assert.throws(
      () => Wiki.open(ai, 'ㄱ'.repeat(Wiki.TITLE_MAX + 1), body('본문'), null, null),
      RuleViolation,
    );
  });

  test('내용이 같으면 판을 쌓지 않는다', () => {
    const wiki = Wiki.open(ai, '제목', body('본문'), null, null);
    wiki.revise('제목', body('본문'), ai);
    assert.equal(wiki.revisionCount, 1);
  });

  test('AI가 고치면 새 판만 쌓이고, 사람이 고치면 바뀐 칸이 사람의 것이 된다', () => {
    const wiki = Wiki.open(ai, '제목', body('## 가\n\n1\n\n## 나\n\n2'), null, null);
    wiki.revise('제목', body('## 가\n\n고침\n\n## 나\n\n2'), ai);
    assert.equal(wiki.revisionCount, 2);
    assert.deepEqual(wiki.pinnedSections, []);
    wiki.revise('새 제목', body('## 가\n\n고침\n\n## 나\n\n사람'), human);
    assert.equal(wiki.revisionCount, 3);
    assert.equal(wiki.addedRevision?.kind, 'human');
    assert.deepEqual([...wiki.pinnedSections].sort(), [Wiki.TITLE_KEY, '나'].sort());
  });

  test('공개 여부는 사람만 바꾼다', () => {
    const wiki = Wiki.open(ai, '제목', body('본문'), null, null);
    assert.throws(() => wiki.setVisibility(Wiki.PUBLIC, ai), RuleViolation);
    assert.throws(() => wiki.setVisibility('everyone', human), RuleViolation);
    wiki.setVisibility(Wiki.PUBLIC, human);
    assert.equal(wiki.visibility, Wiki.PUBLIC);
  });

  test('앞 상태로 돌아가면 앞 내용이 새 판으로 쌓인다 (판은 지우지 않는다)', () => {
    const wiki = Wiki.open(ai, '제목', body('처음'), null, null);
    const before = wiki.snapshot();
    wiki.revise('제목', body('고침'), human);
    wiki.rollBack(before, human);
    assert.equal(wiki.body.markdown, '처음');
    assert.equal(wiki.revisionCount, 3);
    assert.deepEqual(wiki.pinnedSections, []);
  });

  test('이 묶음이 만든 wiki를 되돌리면 휴지통으로 간다', () => {
    const wiki = Wiki.open(ai, '제목', body('처음'), null, null);
    wiki.rollBack(null, human);
    assert.equal(wiki.gone, true);
  });
});
