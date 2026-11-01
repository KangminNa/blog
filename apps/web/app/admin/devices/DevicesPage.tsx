'use client';

import { useNotify } from '../AdminShell';
import { DevicesPanel } from './DevicesPanel';

export function DevicesPage({ siteUrl }: { siteUrl: string | null }) {
  const notify = useNotify();
  return (
    <section className="console-inner" aria-label="기기">
      <header className="page-head">
        <h1>기기</h1>
      </header>
      <DevicesPanel runners siteUrl={siteUrl} onMessage={notify} />
    </section>
  );
}
