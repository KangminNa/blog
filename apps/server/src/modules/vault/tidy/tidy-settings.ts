import { DomainEvent, TrackedEntity } from '../../platform';
import type { TidySessionView } from './tidy.view';

// 공간 하나의 세션 정리 설정. 행이 없으면 꺼짐이다 (저장마다 주인의 구독 토큰을 쓴다).
// 정리 일을 요청하는 쪽도 이 객체다: vault는 task를 모르므로 일 요청 이벤트(outbox)로 맡긴다.
// 같은 판의 요청은 requestId가 같아 몇 번을 보내도 작업은 하나다.
export class TidySettings extends TrackedEntity {
  /** task 모듈이 받는 일 요청. 러너는 kind로 cairn-tidy 스킬을 고른다 */
  private static readonly REQUESTED = 'task.task.requested';
  private static readonly KIND = 'tidy_session';
  /** 작업 제목의 상한 (task의 입력 검사와 같다) */
  private static readonly TITLE_MAX = 200;
  private static readonly TITLE_PREFIX = '세션 정리: ';
  private static readonly UNTITLED = '제목 없음';

  private constructor(
    readonly spaceId: string,
    version: number,
    private auto: boolean,
    private updatedOn: Date,
    readonly isNew: boolean,
  ) {
    super(spaceId, version);
  }

  /** 아직 행이 없는 공간: 꺼짐, version 0 */
  static absent(spaceId: string, now: Date): TidySettings {
    return new TidySettings(spaceId, 0, false, now, true);
  }

  static restore(
    spaceId: string,
    version: number,
    autoTidy: boolean,
    updatedAt: Date,
  ): TidySettings {
    return new TidySettings(spaceId, version, autoTidy, updatedAt, false);
  }

  get autoTidy(): boolean {
    return this.auto;
  }

  get updatedAt(): Date {
    return this.updatedOn;
  }

  /** 자동 정리를 켜거나 끈다 */
  turn(on: boolean, now: Date): void {
    if (on === this.auto) return;
    this.auto = on;
    this.updatedOn = now;
    this.track('auto_tidy', on);
    this.track('updated_at', now);
  }

  /** 세션의 새 판이 저장되었다: 켜져 있을 때만 정리를 요청한다 */
  saved(session: TidySessionView, seq: number): void {
    if (this.auto) this.request(session, seq);
  }

  /** 주인이 쌓인 세션의 정리를 요청한다. 자동 정리가 꺼져 있어도 된다 */
  backlog(sessions: readonly TidySessionView[]): void {
    for (const session of sessions) this.request(session, session.seq);
  }

  private request(session: TidySessionView, seq: number): void {
    const title = `${TidySettings.TITLE_PREFIX}${session.title || TidySettings.UNTITLED}`;
    this.record(
      new DomainEvent(TidySettings.REQUESTED, 1, this.spaceId, {
        requestId: `tidy:${session.id}:${seq}`,
        kind: TidySettings.KIND,
        title: title.slice(0, TidySettings.TITLE_MAX),
        targetKind: 'session',
        targetId: session.id,
        baseVersion: session.version,
      }),
    );
  }
}
