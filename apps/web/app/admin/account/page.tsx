import type { Owner } from '../../_account/types';
import { serverGet } from '../../_lib/server-api';
import { AccountPage } from './AccountPage';

// 외부 계정 연결에서 실패하면 ?error=이유 로 돌아온다.
export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, owner] = await Promise.all([searchParams, serverGet<Owner>('/api/auth/me')]);
  if (!owner) return <p className="error">서버에 연결하지 못했어요</p>;
  return <AccountPage owner={owner} error={error ?? null} />;
}
