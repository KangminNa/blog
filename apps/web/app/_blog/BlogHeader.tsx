// 공개 화면의 머리. 이름은 글 목록으로, 오른쪽은 주인이면 콘솔, 아니면 로그인.
export function BlogHeader({ name, owner }: { name: string; owner: boolean }) {
  return (
    <header className="blog-top">
      <a className="blog-brand" href="/">
        {name || 'Cairn'}
      </a>
      <nav aria-label="블로그 메뉴">
        <a href="/graph">그래프</a>
        <a href={owner ? '/admin' : '/login'}>{owner ? '콘솔' : '로그인'}</a>
      </nav>
    </header>
  );
}
