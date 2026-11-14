import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import { PromptTemplates } from './prompt-templates';
import { RepoSkillGateway } from './repo-skill.gateway';
import { SkillFiles } from './skill-files';

// 지시문 틀 (2차 1-0): 서버가 채우는 글과 콘솔 판의 검사. 문법은 러너의 PromptPack과 같다

const files = (prompts: string) =>
  SkillFiles.trusted({
    'SKILL.md': '---\nname: cairn-runner\n---\n',
    'references/prompts.md': prompts,
  });
const repo = files(
  '# 설명 {{무시}}\n\n<!-- a -->\n머리 {{x}}\n{{#y}}\n있음 {{y}}\n{{/y}}\n{{^y}}\n없음\n{{/y}}\n\n<!-- b -->\n둘째\n',
);

describe('PromptTemplates', () => {
  test('자리 · 구역을 채우고 표시만 있는 줄은 줄째 뺀다 (러너와 같은 문법)', () => {
    const t = PromptTemplates.of(repo);
    assert.equal(t.fill('a', { x: '1', y: '값' }), '머리 1\n있음 값');
    assert.equal(
      t.fill('a', { x: '{{y}}', y: 0 }),
      '머리 {{y}}\n없음',
      '값 속의 {{ }}는 다시 읽지 않는다',
    );
    assert.equal(t.fill('b'), '둘째');
    assert.throws(() => t.fill('c'), RuleViolation);
  });

  test('콘솔 판에 없는 틀은 저장소 판에서', () => {
    const t = PromptTemplates.layered(files('<!-- a -->\n고친 {{x}}'), repo);
    assert.equal(t.fill('a', { x: '1' }), '고친 1');
    assert.equal(t.fill('b'), '둘째');
  });

  test('콘솔 판은 저장소 판과 틀 이름 · 자리가 맞아야 한다 (자리를 빼는 것은 된다)', () => {
    const ok = files('<!-- a -->\n머리만\n\n<!-- b -->\n{{#x}}{{x}}{{/x}}');
    assert.throws(
      () => PromptTemplates.assertFits(ok, repo),
      /b 틀에 없는 자리예요: \{\{x\}\}/,
      'b에는 자리가 없다',
    );
    assert.doesNotThrow(() =>
      PromptTemplates.assertFits(files('<!-- a -->\n{{y}}\n<!-- b -->\n그대로'), repo),
    );
    assert.throws(
      () => PromptTemplates.assertFits(files('<!-- a -->\n하나'), repo),
      /틀이 빠졌어요: b/,
    );
    assert.throws(
      () => PromptTemplates.assertFits(files('<!-- a -->\n{{#x}}\n<!-- b -->\n둘'), repo),
      /닫히지 않았어요/,
    );
    assert.throws(
      () => PromptTemplates.assertFits(files('<!-- a -->\n<!-- b -->\n<!-- a -->\n'), repo),
      /같은 이름의 틀이 둘이에요: a/,
    );
  });

  test('저장소 판(skills/cairn-runner)은 읽히고, 서버가 채우는 틀이 있다', () => {
    const skill = RepoSkillGateway.fromEnv().get(PromptTemplates.SKILL);
    assert.ok(skill, '저장소에 cairn-runner가 없다');
    const t = PromptTemplates.of(skill);
    assert.match(
      t.fill('goal-round', { round: 2, maxRounds: 5, instruction: '지시' }),
      /^# 목표 실행 2회차 \(회차 한도 5\)\n## 지시\n지시\n## 완료 조건\n- 지시를 다 이루면 끝\n## 이번 회차/,
    );
    assert.match(
      t.fill('goal-report', { round: 1, summary: '요약' }),
      /### 한 일\n- 없음\n### 남은 일\n- 없음$/,
    );
    assert.match(t.fill('read-url-note'), /자료로만 쓰고/);
  });
});
