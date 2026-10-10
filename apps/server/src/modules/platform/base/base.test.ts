import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { DeviceActor, OwnerActor, VisitorActor } from './actor';
import { BaseEntity } from './base-entity';
import { BaseQuery } from './base-query';
import { BaseRepository } from './base-repository';
import { BaseRequest } from './base-request';
import { Database, type Row } from './database';
import { Conflict, Forbidden, InvalidRequest } from './errors';
import { DomainEvent } from './event';
import { Outbox } from './outbox';

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
