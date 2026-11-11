import type { DomainEvent } from '../base/event';
import type { NoticeNew } from './notices';

/** 알림을 어디로 보내는가: 푸시까지 · 콘솔 알림 센터만 · 남기지 않음 */
export type NoticeRoute = 'push' | 'center' | 'off';

/** 이벤트에서 만들 알림의 내용 (종류 · 등급 · 공간은 NoticeKind가 채운다) */
type NoticeBody = Omit<NoticeNew, 'kind' | 'severity' | 'space_id'>;

// 알림 종류 하나 (7단계). 알리는 모듈이 정해 platform의 NoticeCatalog에 등록한다: 종류 이름 · 화면의 이름 · 등급,
// 그리고 어떤 이벤트에서 알림을 만들고(from) 어떤 이벤트에서 그 알림을 읽음으로 돌리는지(settledOn).
// 등급: immediate(바로 푸시) · digest(묶어서 한 시간 · 하루에 한 번) · log(알림 센터에만).
//   new NoticeKind('task.approval.requested', '결재 요청', NoticeKind.IMMEDIATE)
//     .from(['task.approval.requested'], (e) => ({ title: …, group_key: … }))
//     .settledOn(['task.approval.granted'], (e) => `approval:${e.data.approvalId}`)
export class NoticeKind {
  static readonly IMMEDIATE = 'immediate';
  static readonly DIGEST = 'digest';
  static readonly LOG = 'log';
  static readonly SEVERITIES: readonly string[] = [
    NoticeKind.IMMEDIATE,
    NoticeKind.DIGEST,
    NoticeKind.LOG,
  ];
  static readonly ROUTES: readonly NoticeRoute[] = ['push', 'center', 'off'];

  private topics: readonly string[] = [];
  private build: ((event: DomainEvent) => NoticeBody | null) | null = null;
  private settleTopics: readonly string[] = [];
  private settle: ((event: DomainEvent) => string | null) | null = null;

  constructor(
    /** 알림의 kind 칸 (예: task.approval.requested) */
    readonly kind: string,
    /** 설정 화면에 보이는 이름 */
    readonly label: string,
    readonly severity: string,
  ) {
    if (!NoticeKind.SEVERITIES.includes(severity))
      throw new Error(`알림 등급이 틀렸어요: ${severity}`);
  }

  /** 이 토픽들의 이벤트에서 알림을 만든다. build가 null을 주면 만들지 않는다 */
  from(topics: readonly string[], build: (event: DomainEvent) => NoticeBody | null): this {
    this.topics = topics;
    this.build = build;
    return this;
  }

  /** 이 토픽들의 이벤트가 오면 그 묶음 키의 안 읽은 알림을 읽음으로 (예: 결재가 끝남) */
  settledOn(topics: readonly string[], groupKey: (event: DomainEvent) => string | null): this {
    this.settleTopics = topics;
    this.settle = groupKey;
    return this;
  }

  /** 설정에 없을 때의 경로: 기록만은 알림 센터에만, 나머지는 푸시까지 */
  get defaultRoute(): NoticeRoute {
    return this.severity === NoticeKind.LOG ? 'center' : 'push';
  }

  /** 이 이벤트에서 만들 알림. 없으면 null */
  noticeOf(event: DomainEvent): NoticeNew | null {
    if (this.build === null || !this.topics.includes(event.name)) return null;
    const made = this.build(event);
    return made === null
      ? null
      : { ...made, space_id: event.spaceId, kind: this.kind, severity: this.severity };
  }

  /** 이 이벤트가 읽음으로 돌릴 묶음 키. 없으면 null */
  settledBy(event: DomainEvent): string | null {
    if (this.settle === null || !this.settleTopics.includes(event.name)) return null;
    return this.settle(event);
  }
}
