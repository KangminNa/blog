import { BaseRequest, type RequestFields } from '../base/base-request';
import type { NoticeSettingRow } from '../platform.tables';

// 알림 설정 입력의 모양. 뜻(간격 이름, 시간대, 알려진 종류)은 NoticeSettings가 검사한다.
// 시각은 API에서 "09:00", 칸은 하루 중 분(540).

const VERSION_MAX = 2_147_483_647;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** PUT /api/notice-settings. 처음 저장할 때 version은 0, 고칠 때는 본 version */
export class SaveNoticeSettingsInput extends BaseRequest {
  private constructor(
    readonly version: number,
    readonly settings: Partial<NoticeSettingRow>,
  ) {
    super();
  }

  static from(raw: unknown): SaveNoticeSettingsInput {
    const body = { ...(raw as object) } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) =>
        new SaveNoticeSettingsInput(f.integer('version', 0, VERSION_MAX), {
          digest: f.text('digest', 20),
          digest_minute: SaveNoticeSettingsInput.minuteOf(f, 'digestTime', body.digestTime) ?? -1,
          quiet_start: SaveNoticeSettingsInput.minuteOf(f, 'quietStart', body.quietStart),
          quiet_end: SaveNoticeSettingsInput.minuteOf(f, 'quietEnd', body.quietEnd),
          time_zone: f.text('timeZone', 100),
          routes: Object.fromEntries(f.textMap('routes', 10)),
        }),
    );
  }

  /** "09:30" → 570. 없으면 null */
  private static minuteOf(f: RequestFields, name: string, value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const match = typeof value === 'string' ? TIME.exec(value) : null;
    if (!match) {
      f.reject(name, '00:00~23:59 모양이어야 해요');
      return null;
    }
    return Number(match[1]) * 60 + Number(match[2]);
  }
}
