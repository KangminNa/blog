import type {
  ConsentView,
  DeviceView,
} from '../../../server/src/modules/account/device/device.view';
import type {
  LoginLinkView,
  LoginMethodView,
} from '../../../server/src/modules/account/owner/external-login.view';
import type { OwnerView } from '../../../server/src/modules/account/owner/owner.view';
import type {
  InstallStatusView,
  SpaceView,
} from '../../../server/src/modules/account/space/space.view';

// 서버가 돌려주는 모양. import 없는 view 파일의 toJSON()이 원본이다 (객체설계 6장).
// 서버 코드가 웹 번들에 들어가지 않게 반드시 import type으로만 가져온다.

/** 블로그 정보 (누구나) */
export type SpaceInfo = ReturnType<SpaceView['toJSON']>;
/** 설치 마법사의 다음 단계 */
export type InstallStatus = ReturnType<InstallStatusView['toJSON']>;
/** 기기 하나 (콘솔의 기기 메뉴, 세션의 기기 이름) */
export type Device = ReturnType<DeviceView['toJSON']>;
/** 승인 화면 (/connect, 설치 마법사의 첫 기기) */
export type Consent = ReturnType<ConsentView['toJSON']>;
/** 로그인한 주인 (관리 화면 위쪽) */
export type Owner = ReturnType<OwnerView['toJSON']>;
/** 로그인 화면의 버튼 (켜진 로그인 플러그인) */
export type LoginMethod = ReturnType<LoginMethodView['toJSON']>;
/** 주인에게 연결된 외부 계정 */
export type LoginLink = ReturnType<LoginLinkView['toJSON']>;
