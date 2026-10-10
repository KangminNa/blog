import { Injectable } from '@nestjs/common';
import { Database, type Sql } from './database';

// 쓰기(C·U·D)의 기반. 트랜잭션은 Service만 연다.
// 순서: 권한 확인 → 트랜잭션 { 불러오기 → 객체에 시키기 → 저장 } → 결과.
// 판단은 Entity·Policy에 두고, 여기서는 순서만 정한다. 다른 Service는 부르지 않는다.
@Injectable()
export abstract class BaseService {
  constructor(protected readonly db: Database) {}

  protected transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
