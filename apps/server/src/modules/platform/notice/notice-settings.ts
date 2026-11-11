import { RuleViolation } from '../base/errors';
import { TableEntity } from '../base/table-entity';
import type { NoticeSettingNew, NoticeSettingRow } from '../platform.tables';
import { NoticeKind, type NoticeRoute } from './notice-kind';
import { NoticeSettingsView } from './notice-settings.view';

/** notice_settings 한 줄. 공간마다 한 행이라 엔티티의 id는 공간 id다 */
export interface LoadedNoticeSettings extends NoticeSettingRow {
  id: string;
}

// 공간 하나의 알림 설정 (7단계). 행이 없으면 기본값이다: 묶음은 한 시간마다, 조용한 시간 없음, 경로는 등급의 기본.
//   digest: 묶음 등급 알림을 보내는 간격 (hourly · daily, daily면 digest_minute에)
//   quiet_start · quiet_end: 조용한 시간 (시간대 기준 하루 중 분). 그동안 푸시는 미뤘다가 끝날 때 모아 보낸다
//   routes: 종류 → push · center · off. 등록한 종류(NoticeCatalog)만 적을 수 있다
export class NoticeSettings extends TableEntity<
  LoadedNoticeSettings,
  NoticeSettingNew & { id: string }
> {
  static readonly HOURLY = 'hourly';
  static readonly DAILY = 'daily';
  static readonly DIGESTS: readonly string[] = [NoticeSettings.HOURLY, NoticeSettings.DAILY];
  private static readonly MINUTES_PER_DAY = 1440;

  /** 아직 행이 없는 공간: 기본값, version 0. 처음 저장할 때 넣는다 */
  static absent(spaceId: string): NoticeSettings {
    return new NoticeSettings({
      id: spaceId,
      space_id: spaceId,
      digest: NoticeSettings.HOURLY,
      digest_minute: 9 * 60,
      quiet_start: null,
      quiet_end: null,
      time_zone: 'UTC',
      routes: {},
      version: 0,
      updated_at: new Date(0),
    });
  }

  static restore(row: LoadedNoticeSettings): NoticeSettings {
    return new NoticeSettings(row);
  }

  /** 설정을 한 번에 바꾼다. known: 등록한 알림 종류 (경로를 적을 수 있는 것) */
  configure(settings: Partial<NoticeSettingRow>, known: readonly string[], now: Date): void {
    const {
      digest = '',
      digest_minute: digestMinute = -1,
      quiet_start: quietStart = null,
      quiet_end: quietEnd = null,
      time_zone: timeZone = '',
      routes = {},
    } = settings;
    if (!NoticeSettings.DIGESTS.includes(digest))
      throw new RuleViolation(`묶음 간격은 ${NoticeSettings.DIGESTS.join(' · ')} 중 하나예요`);
    if (!NoticeSettings.minute(digestMinute))
      throw new RuleViolation('묶음을 보낼 시각은 00:00~23:59예요');
    if ((quietStart === null) !== (quietEnd === null))
      throw new RuleViolation('조용한 시간은 시작과 끝을 함께 정해요');
    if (
      quietStart !== null &&
      (!NoticeSettings.minute(quietStart) || !NoticeSettings.minute(quietEnd ?? -1))
    )
      throw new RuleViolation('조용한 시간은 00:00~23:59예요');
    if (quietStart !== null && quietStart === quietEnd)
      throw new RuleViolation('조용한 시간의 시작과 끝이 같아요');
    NoticeSettings.assertTimeZone(timeZone);
    const clean = NoticeSettings.routesOf(routes, known);
    this.put('digest', digest);
    this.put('digest_minute', digestMinute);
    this.put('quiet_start', quietStart);
    this.put('quiet_end', quietEnd);
    this.put('time_zone', timeZone);
    this.put('routes', clean);
    this.put('updated_at', now);
  }

  get timeZone(): string {
    return this.row.time_zone;
  }

  /** 묶음을 하루 한 번 보내는가 (아니면 한 시간마다) */
  get daily(): boolean {
    return this.row.digest === NoticeSettings.DAILY;
  }

  /** 하루 한 번이면 보낼 시각 (하루 중 분) */
  get digestMinute(): number {
    return this.row.digest_minute;
  }

  /** 조용한 시간의 시작 · 끝 (하루 중 분). 없으면 null */
  get quietStart(): number | null {
    return this.row.quiet_start;
  }

  get quietEnd(): number | null {
    return this.row.quiet_end;
  }

  /** 이 종류를 어디로 보내는가. 정하지 않았으면 등급의 기본 */
  routeOf(kind: NoticeKind): NoticeRoute {
    const routes = (this.row.routes ?? {}) as Record<string, NoticeRoute>;
    return routes[kind.kind] ?? kind.defaultRoute;
  }

  view(kinds: readonly NoticeKind[]): NoticeSettingsView {
    return new NoticeSettingsView(
      this.row,
      kinds.map((k) => ({
        kind: k.kind,
        label: k.label,
        severity: k.severity,
        route: this.routeOf(k),
      })),
    );
  }

  private static minute(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value < NoticeSettings.MINUTES_PER_DAY;
  }

  private static assertTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      throw new RuleViolation(`알 수 없는 시간대예요: ${timeZone}`);
    }
  }

  /** 등록한 종류만, 경로는 push · center · off만 */
  private static routesOf(routes: unknown, known: readonly string[]): Record<string, NoticeRoute> {
    if (typeof routes !== 'object' || routes === null || Array.isArray(routes))
      throw new RuleViolation('경로는 종류 → push · center · off 모양이에요');
    const clean: Record<string, NoticeRoute> = {};
    for (const [kind, route] of Object.entries(routes)) {
      if (!known.includes(kind)) throw new RuleViolation(`모르는 알림 종류예요: ${kind}`);
      if (!NoticeKind.ROUTES.includes(route as NoticeRoute))
        throw new RuleViolation(`경로는 ${NoticeKind.ROUTES.join(' · ')} 중 하나예요`);
      clean[kind] = route as NoticeRoute;
    }
    return clean;
  }
}
