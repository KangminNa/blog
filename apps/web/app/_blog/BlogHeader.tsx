import { CairnMark } from '../_ui/CairnMark';

// 블로그(밝은 읽기 화면)의 머리. 블로그 이름은 글 목록으로, 그래프는 첫 화면으로.
export function BlogHeader({ name }: { name: string }) {
  return (
    <header className="blog-top">
      <a className="blog-brand" href="/posts">
        <CairnMark />
        {name || 'cairn'}
      </a>
      <nav aria-label="블로그 메뉴">
        <a href="/posts">글</a>
        <a href="/">그래프</a>
      </nav>
    </header>
  );
}
