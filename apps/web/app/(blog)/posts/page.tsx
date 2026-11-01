import { redirect } from 'next/navigation';

// 글 목록은 첫 화면으로 옮겼다. 예전 주소로 들어와도 같은 쪽을 보여 준다.
export default async function OldPosts({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  redirect(cursor ? `/?cursor=${encodeURIComponent(cursor)}` : '/');
}
