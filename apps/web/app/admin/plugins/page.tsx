'use client';

import { useNotify } from '../AdminShell';
import { PluginsPanel } from './PluginsPanel';

export default function PluginsPage() {
  const notify = useNotify();
  return (
    <section className="console-inner" aria-label="플러그인">
      <header className="page-head">
        <h1>플러그인</h1>
      </header>
      <PluginsPanel onMessage={notify} />
    </section>
  );
}
