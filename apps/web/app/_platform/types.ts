import type { NoticeSettingsView } from '../../../server/src/modules/platform/notice/notice-settings.view';
import type { NotificationListView } from '../../../server/src/modules/platform/notice/notification.view';
import type {
  PushKeyView,
  PushTestView,
} from '../../../server/src/modules/platform/notice/push.view';
import type {
  PluginActionResultView,
  PluginListView,
  PluginSettingView,
  PluginView,
} from '../../../server/src/modules/platform/plugin/plugin.view';

// 서버가 돌려주는 모양 (platform). 서버 코드가 웹 번들에 들어가지 않게 import type으로만 가져온다.

export type NotificationList = ReturnType<NotificationListView['toJSON']>;
export type Notification = NotificationList['notifications'][number];
export type NoticeSettings = ReturnType<NoticeSettingsView['toJSON']>;
export type NoticeKindSetting = NoticeSettings['kinds'][number];
export type PushKey = ReturnType<PushKeyView['toJSON']>;
export type PushTest = ReturnType<PushTestView['toJSON']>;
/** 주인이 보는 플러그인 하나 (플러그인 메뉴, 설치 마법사) */
export type Plugin = ReturnType<PluginView['toJSON']>;
export type PluginList = ReturnType<PluginListView['toJSON']>;
export type PluginSetting = ReturnType<PluginSettingView['toJSON']>;
/** 관리 동작의 결과 (예: 연결 확인) */
export type PluginActionResult = ReturnType<PluginActionResultView['toJSON']>;
