import { BaseEntity, type NoticeNew } from '../../platform';
import type { StaleWikiNew, StaleWikiRow, WikiRow } from '../vault.tables';

/** 지울 만한 wiki 한 줄: 알릴 때의 점수와 제목 */
export type StaleCandidateRow = Pick<StaleWikiRow, 'wiki_id' | 'score'> & Pick<WikiRow, 'title'>;

/** 공간 하나에서 이미 알린 wiki들 (vault.stale_wikis를 공간으로 모은 한 줄) */
export interface LoadedStaleWikis {
  id: string;
  wiki_ids: readonly string[];
}

// 공간 하나의 지울 만한 wiki 알림 기록 (docs/wiki점수.md 7장). 6시간마다 지금 후보와 맞춘다:
// 새로 후보가 된 wiki만 알리고(wiki마다 한 번), 후보에서 빠진 wiki는 기록을 지워 다시 내려가면 또 알린다.
// 알리기만 하고 지우지 않는다: 지우는 것은 주인이다 (원칙 2 · 7).
export class StaleWikis extends BaseEntity {
  /** 알림의 종류이자 묶음 키: 안 읽은 알림이 있으면 새로 쌓지 않고 바꾼다 */
  static readonly NOTICE = 'vault.wiki.stale';
  /** 알림이 여는 콘솔 주소 */
  private static readonly LINK = '/admin/wiki?view=stale';
  /** 알림 본문에 적는 제목 수 */
  private static readonly TITLES = 5;

  private added: readonly StaleCandidateRow[] = [];
  private removed: readonly string[] = [];
  private total = 0;

  private constructor(
    readonly spaceId: string,
    private readonly noticed: ReadonlySet<string>,
  ) {
    super(spaceId, 0);
  }

  static restore(row: LoadedStaleWikis): StaleWikis {
    return new StaleWikis(row.id, new Set(row.wiki_ids));
  }

  /** 지금 후보로 맞춘다: 새 후보는 알리고 기록하고, 빠진 wiki는 기록을 지운다 */
  settle(candidates: readonly StaleCandidateRow[]): void {
    const now = new Set(candidates.map((c) => c.wiki_id));
    this.added = candidates.filter((c) => !this.noticed.has(c.wiki_id));
    this.removed = [...this.noticed].filter((id) => !now.has(id));
    this.total = candidates.length;
  }

  /** 새로 알린 수 */
  get noticedNow(): number {
    return this.added.length;
  }

  /** 새로 넣을 기록 */
  get newRows(): StaleWikiNew[] {
    return this.added.map((c) => ({ wiki_id: c.wiki_id, space_id: this.spaceId, score: c.score }));
  }

  /** 지울 기록 (후보에서 빠진 wiki) */
  get goneIds(): readonly string[] {
    return this.removed;
  }

  /** 새 후보가 있을 때만 알림 하나. 지울지는 주인이 정한다 */
  notice(): NoticeNew | null {
    if (this.added.length === 0) return null;
    const titles = this.added.slice(0, StaleWikis.TITLES).map((c) => c.title);
    const more =
      this.added.length > titles.length ? ` 외 ${this.added.length - titles.length}개` : '';
    return {
      space_id: this.spaceId,
      kind: StaleWikis.NOTICE,
      severity: 'digest',
      group_key: StaleWikis.NOTICE,
      title: `지울 만한 위키 ${this.total}개`,
      body: `오래 쓰이지 않은 위키: ${titles.join(', ')}${more}. 지우면 휴지통으로 가고 되살릴 수 있어요`,
      link: StaleWikis.LINK,
      data: { wikiIds: this.added.map((c) => c.wiki_id), total: this.total },
    };
  }
}
