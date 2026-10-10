import { LoginForm } from '../_install/LoginForm';

// 주인 로그인. ?return=/install 처럼 돌아갈 곳을 받을 수 있다 (이 사이트 안의 경로만).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string }>;
}) {
  const { return: back } = await searchParams;
  const safe = back?.startsWith('/') && !back.startsWith('//') ? back : '/';
  return <LoginForm returnTo={safe} />;
}
