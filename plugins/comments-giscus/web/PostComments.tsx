'use client';

import { useEffect, useRef } from 'react';

// 글 아래(post.after) 자리에 giscus 댓글을 붙인다.
// 댓글 스레드는 글 주소(slug)로 찾는다. 글 제목을 바꿔도 같은 스레드가 이어진다.

type Props = {
  settings: Record<string, string>;
  context: { postId: string; slug: string; title: string; preview?: boolean };
};

const REQUIRED = ['repo', 'repoId', 'category', 'categoryId'];

export default function PostComments({ settings, context }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const missing = REQUIRED.filter((key) => !settings[key]);

  useEffect(() => {
    const el = box.current;
    if (!el || missing.length > 0) return;
    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    const attrs: Record<string, string> = {
      repo: settings.repo ?? '',
      'repo-id': settings.repoId ?? '',
      category: settings.category ?? '',
      'category-id': settings.categoryId ?? '',
      mapping: 'specific',
      term: context.slug,
      strict: '1',
      'reactions-enabled': '1',
      'emit-metadata': '0',
      'input-position': 'top',
      theme: 'preferred_color_scheme',
      lang: 'ko',
      loading: 'lazy',
    };
    for (const [key, value] of Object.entries(attrs)) script.setAttribute(`data-${key}`, value);
    el.replaceChildren(script);
    return () => el.replaceChildren();
  }, [
    settings.repo,
    settings.repoId,
    settings.category,
    settings.categoryId,
    context.slug,
    missing.length,
  ]);

  if (missing.length > 0) {
    // 방문자에게는 아무것도 보이지 않고, 미리보기(개발 화면)에서만 무엇이 비었는지 알려준다
    if (!context.preview) return null;
    return (
      <p
        style={{
          padding: '16px 20px',
          borderRadius: 12,
          border: '1px dashed #c98a2b',
          color: '#8a5a12',
        }}
      >
        giscus 설정이 비어 있어요: {missing.join(', ')}. https://giscus.app 에서 저장소를 고르면
        값이 나와요.
      </p>
    );
  }

  return (
    <section aria-label="댓글" style={{ marginTop: 48 }}>
      <div ref={box} className="giscus" />
    </section>
  );
}
