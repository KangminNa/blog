import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Forbidden, RuleViolation } from '../../platform';
import { MakeMaterials } from './make-materials';

// 만들기 작업의 재료 (DB 없이): 모양 · 한도 · 살아 있는 결과물 · 재료인지 확인.

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('MakeMaterials', () => {
  test('make가 없으면 재료 없음, 있으면 결과물 · 위키 id 목록', () => {
    assert.deepEqual(MakeMaterials.of({}).outputs, []);
    assert.deepEqual(MakeMaterials.of(null).wikis, []);
    const m = MakeMaterials.of({ make: { outputs: [id(1), id(1), id(2)], wikis: [id(3)] } });
    assert.deepEqual(m.outputs, [id(1), id(2)], '겹친 id는 하나로');
    assert.deepEqual(m.wikis, [id(3)]);
    assert.deepEqual(MakeMaterials.of({ make: { wikis: [id(3)] } }).outputs, []);
  });

  test('모양이 틀리거나 한도를 넘으면 RuleViolation', () => {
    assert.throws(() => MakeMaterials.of({ make: 'x' }), RuleViolation);
    assert.throws(() => MakeMaterials.of({ make: [] }), RuleViolation);
    assert.throws(() => MakeMaterials.of({ make: { outputs: 'x' } }), /결과물 재료는 id 목록/);
    assert.throws(() => MakeMaterials.of({ make: { wikis: ['../etc'] } }), /위키 재료는 id 목록/);
    const eleven = Array.from({ length: 11 }, (_, i) => id(i));
    assert.throws(() => MakeMaterials.of({ make: { outputs: eleven } }), /10개까지/);
  });

  test('재료를 적었는지 (make가 아닌 일에는 적지 않는다)', () => {
    assert.equal(MakeMaterials.given({ make: { outputs: [] } }), true);
    assert.equal(MakeMaterials.given({ code: {} }), false);
    assert.equal(MakeMaterials.given(null), false);
  });

  test('맡길 때 없거나 휴지통의 결과물을 알리고, 받을 때 재료가 아니면 Forbidden', () => {
    const m = MakeMaterials.of({ make: { outputs: [id(1), id(2)] } });
    m.assertLive([id(1), id(2)]);
    assert.throws(() => m.assertLive([id(1)]), new RegExp(`휴지통에 있는 결과물이에요: ${id(2)}`));
    m.assertOutput(id(2));
    assert.throws(() => m.assertOutput(id(9)), Forbidden);
  });
});
