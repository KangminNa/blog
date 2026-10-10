import { LoginForm } from '../_install/LoginForm';
import { serverGet } from '../_lib/server-api';
import type { LoginMethod } from '../_lib/types';

// 주인 로그인. ?return=/install 처럼 돌아갈 곳을 받을 수 있다 (이 사이트 안의 경로만).
// 외부 로그인(로그인 플러그인)에서 실패하면 ?error=이유 로 돌아온다.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string; error?: string }>;
}) {
  const { return: back, error } = await searchParams;
  const safe = back?.startsWith('/') && !back.startsWith('//') ? back : '/';
  const methods = (await serverGet<{ methods: LoginMethod[] }>('/api/auth/methods'))?.methods ?? [];
  return <LoginForm returnTo={safe} methods={methods} initialError={error ?? null} />;
}
