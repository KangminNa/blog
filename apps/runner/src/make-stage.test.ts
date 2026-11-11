import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Job } from './job';
import { Json } from './json';
import { MakeMaterials } from './make-stage';

// 만들기 작업의 재료 읽기 (서버가 걸렀어도 지시문 · 도구 입력에 쓰기 전에 다시 본다)와 일의 모양.

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('만들기 작업', () => {
  test('재료는 uuid만, 겹치지 않게, 10개까지', () => {
    const m = MakeMaterials.from({
      outputs: [id(1), id(1), '../x', 3, id(2)],
      wikis: Array.from({ length: 12 }, (_, i) => id(i + 10)),
    });
    assert.deepEqual(m.outputs, [id(1), id(2)]);
    assert.equal(m.wikis.length, 10);
    assert.deepEqual(MakeMaterials.from(null).outputs, []);
    assert.deepEqual(MakeMaterials.from({ outputs: 'x' }).outputs, []);
  });

  test('make 일은 칸의 일이고 payload.make를 들고 온다. 다른 일에는 없다', () => {
    const raw = (kind: string, payload: object) =>
      Json.parse(
        JSON.stringify({
          task: { id: id(99), kind, title: '발표', payload },
          agent: { name: '만들기', role: '', tool: 'claude' },
          instruction: '만들어 주세요',
          run_token: 'cairn_run_x',
        }),
      ) as Json;
    const make = Job.from(raw('make', { make: { outputs: [id(1)], wikis: [] } }));
    assert.equal(make.isMake && make.sandboxed && !make.isCode, true);
    assert.deepEqual(MakeMaterials.from(make.makePayload).outputs, [id(1)]);
    assert.equal(
      make.withBrief('# 재료').makePayload,
      make.makePayload,
      '단락을 더해도 재료는 그대로',
    );
    const general = Job.from(raw('general', { make: { outputs: [id(1)] } }));
    assert.equal(general.sandboxed, false);
    assert.equal(general.makePayload, null);
  });
});
