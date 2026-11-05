import type {
  ConsentView,
  DeviceView,
} from '../../../server/src/modules/account/device/device.view';
import type {
  InstallStatusView,
  SpaceView,
} from '../../../server/src/modules/account/space/space.view';

// 서버가 돌려주는 모양. import 없는 view 파일의 toJSON()이 원본이다 (객체설계 6장).
// 서버 코드가 웹 번들에 들어가지 않게 반드시 import type으로만 가져온다.

export type SpaceInfo = ReturnType<SpaceView['toJSON']>;
export type InstallStatus = ReturnType<InstallStatusView['toJSON']>;
/** 기기 하나 (콘솔의 기기 메뉴, 세션의 기기 이름) */
export type Device = ReturnType<DeviceView['toJSON']>;
/** 승인 화면 (/connect, 설치 마법사의 첫 기기) */
export type Consent = ReturnType<ConsentView['toJSON']>;
