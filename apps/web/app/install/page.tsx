import { InstallWizard } from '../_install/InstallWizard';
import { serverGet } from '../_lib/server-api';
import type { InstallStatus, Owner, SpaceInfo } from '../_lib/types';

// 설치 마법사. 설치 상태(이 브라우저의 통행증 포함)와 로그인한 주인을 서버에서 받아 시작 단계를 정한다.
export const dynamic = 'force-dynamic';

export default async function InstallPage() {
  const [status, space, owner] = await Promise.all([
    serverGet<InstallStatus>('/api/install'),
    serverGet<SpaceInfo>('/api/space'),
    serverGet<Owner>('/api/auth/me'),
  ]);
  if (!status || !space)
    return (
      <main className="empty">
        <h1>서버에 연결하지 못했어요</h1>
        <p>서버(:4000)가 떠 있는지 확인해 주세요.</p>
      </main>
    );
  return <InstallWizard status={status} space={space} owner={owner} />;
}
