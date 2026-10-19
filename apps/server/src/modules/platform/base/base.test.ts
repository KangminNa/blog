import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { DeviceActor, OwnerActor, VisitorActor } from './actor';
import { AttemptLimiter } from './attempt-limiter';
import { BaseEntity } from './base-entity';
import { BaseQuery } from './base-query';
import { BaseRepository } from './base-repository';
import { BaseRequest } from './base-request';
import { Database, type Row } from './database';
import { Conflict, Forbidden, InvalidRequest, TooManyRequests } from './errors';
import { DomainEvent } from './event';
import { Idempotency } from './idempotency';
import { Outbox } from './outbox';
import { PasswordHasher } from './password-hasher';
import { SecretBox } from './secret-box';

// 기반 클래스가 약속한 동작을 실제 DB로 확인한다.

const db = new Database();
after(() => db.onApplicationShutdown());

class Sample extends BaseEntity {
  static open(): Sample {
    return new Sample(BaseEntity.newId(), 1);
  }
  rename(spaceId: string): void {
    this.record(new DomainEvent('vault.sample.renamed', 1, spaceId, { id: this.id }));
  }
}

class SampleRequest extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly title: string,
    readonly tool: string,
  ) {
    super();
  }
  static from(raw: unknown): SampleRequest {
    return BaseRequest.read(raw, (f) => {
      const source = f.nested('source');
      return new SampleRequest(f.uuid('requestId'), f.text('title', 5), source.text('tool', 40));
    });
  }
}

class SampleQuery extends BaseQuery {
  async visibleCount(actor: OwnerActor | VisitorActor): Promise<number> {
    const [row] = await this.sql`
      SELECT count(*)::int AS n FROM (VALUES ('public'), ('private')) AS t(visibility)
      WHERE true ${this.visibleTo(actor, 't.visibility')}`;
    return Number(row?.n);
  }
}

class SampleRepository extends BaseRepository<Sample> {
  protected toEntity(_row: Row): Sample {
    return Sample.open();
  }
  check(count: number, sample: Sample): void {
    this.expectUpdated(count, sample);
  }
}

describe('BaseRequest', () => {
  test('틀린 필드를 모두 모아 한 번에 알린다 (안쪽 객체 포함)', () => {
    assert.throws(
      () => SampleRequest.from({ requestId: 'nope', title: '너무 긴 제목', source: {} }),
      (error: unknown) => {
        assert.ok(error instanceof InvalidRequest);
        assert.deepEqual([...error.fields.keys()].sort(), ['requestId', 'source.tool', 'title']);
        return true;
      },
    );
  });

  test('올바른 입력은 객체가 된다', () => {
    const id = '0192d2a0-0000-7000-8000-000000000000';
    const request = SampleRequest.from({ requestId: id, title: '제목', source: { tool: 'codex' } });
    assert.equal(request.tool, 'codex');
  });
});

describe('BaseEntity', () => {
  test('id는 시간순으로 정렬되는 UUIDv7', () => {
    const a = Sample.open().id;
    const b = Sample.open().id;
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(a.slice(0, 13) <= b.slice(0, 13));
  });
});

describe('Actor', () => {
  test('기기는 받은 권한만, 방문자는 아무것도', () => {
    const device = new DeviceActor('s', 'd', new Set([DeviceActor.UPLOAD]));
    device.assertCan(DeviceActor.UPLOAD);
    assert.throws(() => device.assertCan(DeviceActor.READ_ALL), Forbidden);
    assert.equal(new VisitorActor().canSeePrivate(), false);
  });
});

describe('BaseQuery', () => {
  test('방문자에게는 공개만, 주인에게는 전부', async () => {
    const query = new SampleQuery(db);
    assert.equal(await query.visibleCount(new VisitorActor()), 1);
    assert.equal(await query.visibleCount(new OwnerActor('s', 'u')), 2);
  });
});

describe('BaseRepository', () => {
  test('바뀐 행이 없으면 Conflict, 있으면 버전이 오른다', () => {
    const repository = new SampleRepository(db.sql);
    const sample = Sample.open();
    assert.throws(() => repository.check(0, sample), Conflict);
    repository.check(1, sample);
    assert.equal(sample.version, 2);
  });
});

describe('Outbox', () => {
  test('이벤트는 트랜잭션과 함께 커밋되거나 함께 취소된다', async () => {
    const spaceId = '0192d2a0-0000-7000-8000-00000000abcd';
    const sample = Sample.open();
    sample.rename(spaceId);

    await assert.rejects(
      db.transaction(async (tx) => {
        await new Outbox(tx).publish(sample.pullEvents());
        const [row] =
          await tx`SELECT count(*)::int AS n FROM platform.outbox WHERE space_id = ${spaceId}`;
        assert.equal(row?.n, 1);
        throw new Error('되돌리기');
      }),
      /되돌리기/,
    );
    const [row] =
      await db.sql`SELECT count(*)::int AS n FROM platform.outbox WHERE space_id = ${spaceId}`;
    assert.equal(row?.n, 0);
  });
});

describe('Idempotency (M1)', () => {
  const device = '0192d2a0-0000-7000-8000-00000000beef';

  test('처음이면 null, 결과를 남긴 뒤에는 그 결과. 되돌린 트랜잭션은 자리를 남기지 않는다', async () => {
    const requestId = `req-${Date.now()}`;
    await assert.rejects(
      db.transaction(async (tx) => {
        assert.equal(await new Idempotency(tx, device, requestId, 'sample').previous(), null);
        throw new Error('되돌리기');
      }),
      /되돌리기/,
    );
    await db.transaction(async (tx) => {
      const once = new Idempotency(tx, device, requestId, 'sample');
      assert.equal(await once.previous(), null);
      await once.remember({ status: 'saved', n: 1 });
    });
    const again = await db.transaction((tx) =>
      new Idempotency(tx, device, requestId, 'sample').previous(),
    );
    assert.deepEqual(again, { status: 'saved', n: 1 });
    await assert.rejects(
      db.transaction((tx) => new Idempotency(tx, device, requestId, 'other').previous()),
      Conflict,
    );
  });

  test('같은 요청이 동시에 오면 뒤의 요청은 앞의 결과를 받는다', async () => {
    const requestId = `req-race-${Date.now()}`;
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        db.transaction(async (tx) => {
          const once = new Idempotency(tx, device, requestId, 'sample');
          const before = await once.previous();
          if (before) return before;
          await tx`SELECT pg_sleep(0.05)`;
          await once.remember({ by: n });
          return { by: n };
        }),
      ),
    );
    assert.equal(new Set(results.map((r) => JSON.stringify(r))).size, 1, '셋 모두 같은 결과');
  });
});

describe('입력 읽기 (M1)', () => {
  class NumbersRequest extends BaseRequest {
    private constructor(
      readonly version: number,
      readonly values: ReadonlyMap<string, string>,
    ) {
      super();
    }
    static from(raw: unknown): NumbersRequest {
      return BaseRequest.read(raw, (f) => {
        const request = new NumbersRequest(f.integer('version', 1, 10), f.textMap('values', 3));
        if (request.values.has('forbidden')) f.reject('values', '쓸 수 없는 이름이에요');
        return request;
      });
    }
  }

  test('정수·문자열 묶음·직접 알린 문제를 한 번에 모은다', () => {
    assert.throws(
      () => NumbersRequest.from({ version: 1.5, values: { a: 'toolong', b: 1, forbidden: '' } }),
      (error: InvalidRequest) => {
        assert.deepEqual([...error.fields.keys()].sort(), [
          'values',
          'values.a',
          'values.b',
          'version',
        ]);
        return true;
      },
    );
    const ok = NumbersRequest.from({ version: 3, values: { a: 'x', b: '' } });
    assert.equal(ok.version, 3);
    assert.deepEqual(
      [...ok.values],
      [
        ['a', 'x'],
        ['b', ''],
      ],
    );
  });

  test('문자열 목록: 없으면 null, 모양이 틀리면 몇 번째인지 알린다', () => {
    class ListRequest extends BaseRequest {
      private constructor(readonly items: readonly string[] | null) {
        super();
      }
      static from(raw: unknown): ListRequest {
        return BaseRequest.read(raw, (f) => new ListRequest(f.optionalTextList('items', 2, 5)));
      }
    }
    assert.equal(ListRequest.from({}).items, null);
    assert.deepEqual(ListRequest.from({ items: ['a', 'b'] }).items, ['a', 'b']);
    assert.throws(
      () => ListRequest.from({ items: ['ok', 7] }),
      (error: InvalidRequest) => [...error.fields.keys()].join() === 'items.1',
    );
    assert.throws(
      () => ListRequest.from({ items: ['a', 'b', 'c'] }),
      (error: InvalidRequest) => [...error.fields.keys()].join() === 'items',
    );
  });

  test('보고 고친 버전이 다르면 Conflict', () => {
    const sample = Sample.open();
    sample.assertVersion(1);
    assert.throws(() => sample.assertVersion(2), Conflict);
  });
});

describe('SecretBox: 값 만들기와 짧은 값 싸기 (M1)', () => {
  const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
  const other = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });

  test('같은 키·같은 이름이면 늘 같은 값, 키가 다르면 다른 값', () => {
    assert.deepEqual(box.derive('install-code'), box.derive('install-code'));
    assert.notDeepEqual(box.derive('install-code'), other.derive('install-code'));
    assert.notDeepEqual(box.derive('install-code'), box.derive('pack'));
  });

  test('싼 값은 같은 키로, 만료 전에만 풀린다', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const token = box.pack('install:abc|/admin', 600, now);
    assert.equal(box.unpack(token, now), 'install:abc|/admin');
    assert.equal(box.unpack(token, new Date(now.getTime() + 601_000)), null, '만료');
    assert.equal(other.unpack(token, now), null, '다른 키');
    assert.equal(box.unpack(null, now), null);
    assert.equal(box.unpack('not-a-token', now), null);
  });

  test('싼 값에는 원문이 보이지 않고, 한 글자만 고쳐도 풀리지 않는다. 같은 값도 쌀 때마다 다르다', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const token = box.pack('install:abc|/admin', 600, now);
    const raw = Buffer.from(token, 'base64url');
    assert.equal(raw.includes('install'), false, '원문');
    assert.equal(raw.includes(String(Math.floor(now.getTime() / 1000) + 600)), false, '만료 시각');
    for (const at of [0, 14, raw.length - 1]) {
      const forged = Buffer.from(raw);
      forged[at] = (forged[at] ?? 0) ^ 1;
      assert.equal(box.unpack(forged.toString('base64url'), now), null, `${at}번째 바이트를 바꿈`);
    }
    assert.notEqual(box.pack('same', 600, now), box.pack('same', 600, now));
  });
});

describe('AttemptLimiter (M1)', () => {
  test('창 안에서 max번까지만, 창이 지나면 다시', () => {
    const limiter = new AttemptLimiter(2, 60_000);
    limiter.hit('1.2.3.4', 0);
    limiter.hit('1.2.3.4', 1_000);
    assert.throws(() => limiter.hit('1.2.3.4', 2_000), TooManyRequests);
    limiter.hit('5.6.7.8', 2_000);
    limiter.hit('1.2.3.4', 61_000);
  });

  test('틀린 시도만 세면, 맞는 시도는 몇 번이든 막지 않는다', () => {
    const limiter = new AttemptLimiter(2, 60_000);
    for (let i = 0; i < 10; i++) limiter.check('owner', i);
    limiter.fail('owner', 10);
    limiter.fail('owner', 11);
    assert.throws(() => limiter.check('owner', 12), TooManyRequests);
  });
});

describe('PasswordHasher (M1)', () => {
  const hasher = new PasswordHasher();

  test('바꾼 값으로만 확인되고, 원문은 저장값에 없다', async () => {
    const stored = await hasher.hash('correct horse battery');
    assert.match(stored, /^scrypt\$15\$8\$1\$/);
    assert.equal(stored.includes('correct horse battery'), false);
    assert.notEqual(stored, await hasher.hash('correct horse battery'), '소금이 달라 매번 다른 값');
    assert.equal(await hasher.verify('correct horse battery', stored), true);
    assert.equal(await hasher.verify('correct horse batterY', stored), false);
    assert.equal(await hasher.verify('anything', null), false, '저장값이 없으면 늘 false');
    assert.equal(await hasher.verify('anything', 'garbage'), false);
  });

  test('약한 강도로 저장된 값은 확인되지만 다시 저장하라고 알린다', async () => {
    const stored = await hasher.hash('correct horse battery');
    const weaker = stored.replace(/^scrypt\$15\$/, 'scrypt$14$');
    assert.equal(hasher.needsRehash(stored), false);
    assert.equal(hasher.needsRehash(weaker), true);
  });
});
