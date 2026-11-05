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
  return <AccountPage login={owner?.login ?? ''} error={error ?? null} />;
}
