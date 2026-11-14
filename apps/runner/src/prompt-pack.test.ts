import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { SkillPackage } from './job';
import { Json } from './json';
import { PromptPack, PromptProblem, PromptTemplate } from './prompt-pack';
import { Redactor, RunLog } from './redactor';

// 지시문의 글은 러너 스킬 cairn-runner의 틀에서 온다 (2차 1-0)

const SKILLS = resolve(__dirname, '../../../skills');

/** 로그를 모아 두는 시험용 로그 */
class HeardLog extends RunLog {
  readonly heard: string[] = [];

  constructor() {
    super(new Redactor([]));
  }

  override info(message: string): void {
    this.heard.push(message);
  }
}

const shipped = (prompts: string, source = 'console') =>
  SkillPackage.from(
    Json.of({
      name: 'cairn-runner',
      source,
      revision: 3,
      hash: 'abcdef0123',
      files: { 'SKILL.md': '---\nname: cairn-runner\n---\n', 'references/prompts.md': prompts },
    }),
  );

describe('PromptTemplate', () => {
  test('자리에 값을 넣고, 값 속의 {{ }}는 다시 읽지 않는다', () => {
    const t = PromptTemplate.parse('t', '# 할 일: {{title}}\n{{instruction}}');
    assert.equal(
      t.fill({ title: '정리', instruction: '{{title}}을 그대로' }),
      '# 할 일: 정리\n{{title}}을 그대로',
    );
  });

  test('{{#자리}}는 값이 있을 때만, {{^자리}}는 없을 때만. 표시만 있는 줄은 줄째 빠진다', () => {
    const t = PromptTemplate.parse(
      't',
      '머리\n{{#rounds}}\n남은 횟수: {{rounds}}.\n{{/rounds}}\n{{^rounds}}\n더 없음\n{{/rounds}}',
    );
    assert.equal(t.fill({ rounds: 2 }), '머리\n남은 횟수: 2.');
    assert.equal(t.fill({ rounds: 0 }), '머리\n더 없음');
    assert.equal(t.fill({}), '머리\n더 없음', '넣지 않은 자리는 없음');
  });

  test('한 줄 안의 구역, 안의 빈 줄은 그대로', () => {
    const t = PromptTemplate.parse('t', '{{id}}{{#version}}, 판 {{version}}{{/version}}');
    assert.equal(t.fill({ id: 'a', version: '3' }), 'a, 판 3');
    assert.equal(t.fill({ id: 'a', version: null }), 'a');
    const blank = PromptTemplate.parse('t', '{{#h}}\n# 앞\n{{h}}\n\n{{/h}}\n# 뒤');
    assert.equal(blank.fill({ h: '줄' }), '# 앞\n줄\n\n# 뒤');
    assert.equal(blank.fill({ h: '' }), '# 뒤');
  });

  test('짝이 맞지 않는 표시는 읽지 않는다', () => {
    assert.throws(() => PromptTemplate.parse('t', '{{#a}}글'), PromptProblem);
    assert.throws(() => PromptTemplate.parse('t', '글{{/a}}'), PromptProblem);
    assert.throws(() => PromptTemplate.parse('t', '{{#a}}{{#b}}{{/a}}{{/b}}'), PromptProblem);
  });
});

describe('PromptPack', () => {
  test('표시 줄부터 다음 표시 전까지가 틀 하나 (첫 표시 앞의 설명과 앞뒤 빈 줄은 뺀다)', () => {
    const pack = PromptPack.parse(
      '시험',
      new Map([
        [
          'references/prompts.md',
          '# 설명 {{무시}}\n\n<!-- a -->\n\n글 {{x}}\n\n<!-- b -->\n둘째\n',
        ],
        ['SKILL.md', '<!-- c -->\n스킬 본문은 틀이 아니다'],
      ]),
    );
    assert.equal(pack.fill('a', { x: '하나' }), '글 하나');
    assert.equal(pack.fill('b'), '둘째');
    assert.throws(() => pack.fill('c'), /지시문 틀이 없어요/);
  });

  test('같은 이름의 틀이 둘이면 읽지 않는다', () => {
    assert.throws(
      () =>
        PromptPack.parse(
          '시험',
          new Map([
            ['references/a.md', '<!-- a -->\n하나'],
            ['references/b.md', '<!-- a -->\n둘'],
          ]),
        ),
      /같은 이름의 틀/,
    );
  });

  test('서버가 보낸 판이 먼저, 그 판에 없는 틀은 러너의 판에서', () => {
    const pack = PromptPack.choose(
      shipped('<!-- task -->\n고친 할 일: {{title}}'),
      SKILLS,
      new HeardLog(),
    );
    assert.equal(pack.source, '콘솔 판 3 (abcdef0)');
    assert.equal(pack.fill('task', { title: '정리' }), '고친 할 일: 정리');
    assert.match(pack.fill('intro', { agent: '편집자' }), /에이전트 "편집자"/);
  });

  test('보낸 판을 읽지 못하면 러너의 판을 쓰고 까닭을 알린다', () => {
    const log = new HeardLog();
    const pack = PromptPack.choose(shipped('<!-- task -->\n{{#a}}'), SKILLS, log);
    const said = log.heard;
    assert.equal(pack.source, '러너의 skills/');
    assert.match(said[0] ?? '', /러너의 판을 써요/);
    assert.equal(said[1], '지시문 틀: 러너의 skills/', '어느 판인지 남긴다');
    assert.equal(PromptPack.choose(null, SKILLS, new HeardLog()).source, '러너의 skills/');
  });

  test('저장소 판은 모든 틀을 읽는다', () => {
    const pack = PromptPack.read(SKILLS);
    for (const name of [
      'intro',
      'task',
      'chat',
      'chat-owner',
      'chat-agent',
      'target',
      'goal',
      'revision',
      'subtasks',
      'subtask',
      'site',
      'team',
      'member',
      'skill',
      'work',
      'folders',
      'folder',
      'code',
      'code-replay',
      'make',
    ])
      assert.doesNotThrow(() => pack.fill(name), name);
  });
});
