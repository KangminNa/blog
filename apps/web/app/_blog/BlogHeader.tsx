// 공개 화면의 머리. 이름은 글 목록으로, 오른쪽은 주인이면 콘솔, 아니면 로그인. 페이지는 공개한 것이 있을 때만.
export function BlogHeader({
  name,
  logoUrl,
  owner,
  pages,
}: {
  name: string;
  /** 사이트 로고 (사이트 메뉴에서 올린 그림). 없으면 이름만 */
  logoUrl: string | null;
  owner: boolean;
  pages: boolean;
}) {
  return (
    <header className="blog-top">
      <a className="blog-brand" href="/">
        {logoUrl && (
          // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
          <img className="brand-logo" src={logoUrl} alt="" />
        )}
        {name || 'Cairn'}
      </a>
      <nav aria-label="블로그 메뉴">
        {pages && <a href="/pages">페이지</a>}
        <a href="/graph">그래프</a>
        <a href={owner ? '/admin' : '/login'}>{owner ? '콘솔' : '로그인'}</a>
      </nav>
    </header>
  );
}
