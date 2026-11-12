import type { NoticeSettingsView } from '../../../server/src/modules/platform/notice/notice-settings.view';
import type { NotificationListView } from '../../../server/src/modules/platform/notice/notification.view';
import type {
  PushKeyView,
  PushTestView,
} from '../../../server/src/modules/platform/notice/push.view';

// 서버가 돌려주는 모양 (platform). 서버 코드가 웹 번들에 들어가지 않게 import type으로만 가져온다.

export type NotificationList = ReturnType<NotificationListView['toJSON']>;
export type Notification = NotificationList['notifications'][number];
export type NoticeSettings = ReturnType<NoticeSettingsView['toJSON']>;
export type NoticeKindSetting = NoticeSettings['kinds'][number];
export type PushKey = ReturnType<PushKeyView['toJSON']>;
export type PushTest = ReturnType<PushTestView['toJSON']>;
