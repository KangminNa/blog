import type { SpaceInfo } from '../../_account/types';
import { serverGet } from '../../_lib/server-api';
import { SitePanel } from './SitePanel';

export default async function Site() {
  const space = await serverGet<SpaceInfo>('/api/space');
  if (!space) return <p className="error">서버에 연결하지 못했어요</p>;
  return (
    <section className="console-inner narrow" aria-label="사이트">
      <header className="page-head">
        <h1>사이트</h1>
      </header>
      <SitePanel space={space} />
    </section>
  );
}
