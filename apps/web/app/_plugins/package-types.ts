import type { ReactNode } from 'react';

// 기능 패키지의 콘솔 화면이 받는 값 (목록 파일 menu의 page). 화면은 react와 자기 폴더만 가져오므로
// 서버 호출과 알림을 콘솔이 넘겨 준다. call은 /api/p/<패키지>/<경로>를 부른다.
// '/api/'로 시작하는 경로는 코어의 읽기(GET)만 부를 수 있다 (주인 세션 그대로, 쓰기는 패키지 경로로만).
export type PackageCall = (method: string, path: string, body?: object) => Promise<PackageReply>;
export type PackageReply = { ok: true; data: unknown } | { ok: false; message: string };
export type PackagePageProps = { call: PackageCall; notify: (text: string) => void };

/** 메서드 꼴로 둔다: 화면마다 자기 props만 받아도 들어갈 수 있게 */
export type PackageEntry = {
  plugin: string;
  group: string;
  name: string;
  icon: string;
  Page(props: PackagePageProps): ReactNode;
};
