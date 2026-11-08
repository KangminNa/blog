import { PackagePage } from './PackagePage';

// 기능 패키지의 콘솔 화면 하나 (메뉴는 목록 파일 menu). 화면은 패키지가 그리고, 콘솔은 틀과 호출을 준다.
export default async function Page({ params }: { params: Promise<{ plugin: string }> }) {
  const { plugin } = await params;
  return <PackagePage plugin={plugin} />;
}
