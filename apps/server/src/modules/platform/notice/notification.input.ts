import { BaseRequest } from '../base/base-request';

/** POST /api/notifications/read { ids? }. ids가 없으면 안 읽은 알림 모두 */
export class ReadNotificationsInput extends BaseRequest {
  private static readonly MAX = 100;
  private static readonly ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  private constructor(readonly ids: readonly string[] | null) {
    super();
  }

  static from(raw: unknown): ReadNotificationsInput {
    return BaseRequest.read(raw ?? {}, (f) => {
      const ids = f.optionalTextList('ids', ReadNotificationsInput.MAX, 36);
      if (ids?.some((id) => !ReadNotificationsInput.ID.test(id)))
        f.reject('ids', '알림 id 목록이어야 해요');
      return new ReadNotificationsInput(ids);
    });
  }
}
