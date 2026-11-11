import { Injectable } from '@nestjs/common';
import type { Sql } from '../base/database';
import type { DomainEvent } from '../base/event';
import type { NoticeKind } from './notice-kind';
import { Notices } from './notices';

// 알림 종류의 목록 (7단계). 알리는 모듈이 onModuleInit에서 define으로 등록한다. platform은 무엇을 알리는지 모른다.
// 이벤트에서 만드는 알림은 이벤트를 outbox에 쓰는 같은 트랜잭션에서 남긴다 (Outbox.listen): 일이 되돌려지면 알림도 남지 않는다.
// 이벤트 없이 바로 남기는 알림(지울 만한 위키, 스케줄 한도)도 설정 화면에 보이게 종류는 여기에 등록한다.
@Injectable()
export class NoticeCatalog {
  private readonly kinds = new Map<string, NoticeKind>();

  /** 종류 하나. 같은 이름을 다시 등록하면 바꾼다 */
  define(kind: NoticeKind): void {
    this.kinds.set(kind.kind, kind);
  }

  /** 등록한 종류 (이름 순서) */
  all(): readonly NoticeKind[] {
    return [...this.kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  }

  /** 이벤트에서 알림을 만들고, 끝난 일의 알림을 읽음으로 돌린다 (Outbox가 같은 트랜잭션에서 부른다) */
  async onEvents(tx: Sql, events: readonly DomainEvent[]): Promise<void> {
    const notices = new Notices(tx);
    for (const event of events)
      for (const kind of this.kinds.values()) {
        const notice = kind.noticeOf(event);
        if (notice !== null) await notices.post(notice);
        const settled = kind.settledBy(event);
        if (settled !== null) await notices.settle(event.spaceId, settled, new Date());
      }
  }
}
