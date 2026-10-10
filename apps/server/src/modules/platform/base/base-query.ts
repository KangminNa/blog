import { Injectable } from '@nestjs/common';
import type { Actor } from './actor';
import { Database, type Sql } from './database';

// 읽기(R)의 기반. 화면·AI가 함께 보는 묶음(View)을 SQL로 바로 만든다. 쓰지 않는다.
// 공개 메서드는 모두 첫 인자로 Actor를 받고, 공개 범위를 SQL에서 거른 뒤 개수·순위를 계산한다.
@Injectable()
export abstract class BaseQuery {
  constructor(protected readonly db: Database) {}

  protected get sql(): Sql {
    return this.db.sql;
  }

  /**
   * 공개 범위 조건. 비공개를 볼 수 없는 요청자에게는 `AND <열> = 'public'`을 붙인다.
   * 사용: sql`SELECT … WHERE space_id = ${id} ${this.visibleTo(actor, 's.visibility')}`
   */
  protected visibleTo(actor: Actor, column = 'visibility') {
    return actor.canSeePrivate() ? this.sql`` : this.sql`AND ${this.sql(column)} = 'public'`;
  }
}
