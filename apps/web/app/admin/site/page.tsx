import { serverGet } from '../../_lib/server-api';
import type { SpaceInfo } from '../../_lib/types';
import { SitePage } from './SitePage';

export default async function Site() {
  const space = await serverGet<SpaceInfo>('/api/space');
  if (!space) return <p className="error">서버에 연결하지 못했어요</p>;
  return <SitePage space={space} />;
}
