import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ToolTexts } from './tool-texts';

// 도구의 글은 코드 밖(설명서 · 콘솔 판)에서 와서 입력 모양에 얹힌다 (2차 1-0)

const tool = {
  name: 'delegate',
  inputSchema: {
    properties: {
      title: { type: 'string', maxLength: 10 },
      note: { type: 'object', properties: { body: { type: 'string' } } },
      subtasks: {
        type: 'array',
        items: { type: 'object', properties: { to: { type: 'string' } } },
      },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};
const full = {
  delegate: {
    description: '하위 작업을 맡긴다',
    input: {
      title: '제목',
      note: '메모',
      'note.body': '메모 본문',
      subtasks: '맡길 일',
      'subtasks[].to': '받는 팀원',
      tags: '태그',
    },
  },
};

describe('ToolTexts', () => {
  test('칸 경로: 객체 안은 a.b, 배열 항목 안은 a[].b (글자 배열의 항목은 경로가 없다)', () => {
    assert.deepEqual(ToolTexts.paths(tool.inputSchema), [
      'title',
      'note',
      'note.body',
      'subtasks',
      'subtasks[].to',
      'tags',
    ]);
  });

  test('설명과 칸 설명을 얹고, 원래 모양은 그대로 둔다 (형식 · 길이는 코드의 것)', () => {
    const said = ToolTexts.of(full).describe(tool);
    assert.equal(said.description, '하위 작업을 맡긴다');
    const props = said.inputSchema.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(props.title, { type: 'string', maxLength: 10, description: '제목' });
    const sub = props.subtasks as { items: { properties: { to: { description: string } } } };
    assert.equal(sub.items.properties.to.description, '받는 팀원');
    assert.equal(
      (tool.inputSchema.properties.title as Record<string, unknown>).description,
      undefined,
      '원본은 바뀌지 않는다',
    );
  });

  test('맞지 않는 곳을 모두 찾는다: 글 없는 도구 · 칸, 없는 도구 · 칸의 글', () => {
    assert.deepEqual(ToolTexts.of(full).problems([tool]), []);
    const partial = ToolTexts.of({
      delegate: { description: '맡긴다', input: { title: '제목', ghost: '없는 칸' } },
      gone: { description: '없어진 도구' },
    });
    assert.deepEqual(partial.problems([tool, { name: 'bare', inputSchema: {} }]), [
      'delegate.note: 칸 설명이 없어요',
      'delegate.note.body: 칸 설명이 없어요',
      'delegate.subtasks: 칸 설명이 없어요',
      'delegate.subtasks[].to: 칸 설명이 없어요',
      'delegate.tags: 칸 설명이 없어요',
      'delegate.ghost: 없는 칸의 설명이에요',
      'bare: 도구 설명이 없어요',
      'gone: 없는 도구의 설명이에요',
    ]);
  });

  test('같은 도구가 두 설명서에 있으면 시작하지 않는다', () => {
    assert.throws(() => ToolTexts.of(full, full), /delegate이\(가\) 두 번/);
  });
});
