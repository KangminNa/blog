import { notFound } from 'next/navigation';
import { Slot } from '../../_plugins/Slot';

// 개발용 화면: 블로그 글 페이지(M4)가 생기기 전에 플러그인 화면 자리를 확인한다. 운영 빌드에서는 없다.
export const dynamic = 'force-dynamic';

export default function SlotsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '72px 24px', lineHeight: 1.8 }}>
      <p style={{ fontFamily: 'ui-monospace, monospace', color: '#8E887D', margin: 0 }}>
        개발용 · 플러그인 화면 자리 미리보기
      </p>
      <h1 style={{ fontSize: 32, margin: '8px 0 24px' }}>MCP 서버에 GitHub 로그인 붙이기</h1>
      <p style={{ color: '#BDB6AA' }}>
        예시 글이에요. 실제 글 페이지가 생기면 같은 자리(post.after)가 본문 바로 아래에 들어가요.
      </p>
      <hr style={{ border: 0, borderTop: '1px solid #34322D', margin: '40px 0' }} />
      <Slot
        name="post.after"
        context={{
          postId: 'sample',
          slug: 'mcp-github-login',
          title: 'MCP 서버에 GitHub 로그인 붙이기',
          preview: true,
        }}
      />
    </main>
  );
}
