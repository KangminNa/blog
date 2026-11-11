import type { NotificationListView } from '../../../server/src/modules/platform/notice/notification.view';

// 서버가 돌려주는 모양 (platform). 서버 코드가 웹 번들에 들어가지 않게 import type으로만 가져온다.

export type NotificationList = ReturnType<NotificationListView['toJSON']>;
export type Notification = NotificationList['notifications'][number];
