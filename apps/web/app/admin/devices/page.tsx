import type { SpaceInfo } from '../../_account/types';
import { serverGet } from '../../_lib/server-api';
import { DevicesPage } from './DevicesPage';

export default async function Devices() {
  const space = await serverGet<SpaceInfo>('/api/space');
  return <DevicesPage siteUrl={space?.siteUrl ?? null} />;
}
