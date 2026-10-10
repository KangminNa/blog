import { redirect } from 'next/navigation';
import { ConsentCard } from '../_install/ConsentCard';
import { serverFetch } from '../_lib/server-api';
import type { Consent } from '../_lib/types';

// 기기 연결 승인 화면. AI 도구(Claude Code 등)가 브라우저를 열어 여기로 보낸다 (?request=서명한 승인 요청).
// 주인이 로그인해 있지 않으면 로그인한 뒤 다시 이 화면으로 돌아온다.
export const dynamic = 'force-dynamic';

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request = '' } = await searchParams;
  const reply = await serverFetch<Consent>(`/api/connect?request=${encodeURIComponent(request)}`);
  if (reply.status === 403 || reply.status === 401)
    redirect(`/login?return=${encodeURIComponent(`/connect?request=${request}`)}`);
  return (
    <ConsentCard
      request={request}
      consent={reply.status === 200 ? reply.data : null}
      problem={
        reply.status === 200
          ? null
          : '만료됐거나 맞지 않는 승인 요청이에요. AI 도구에서 다시 연결해 주세요.'
      }
    />
  );
}
