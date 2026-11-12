'use client';

import { callFor, packageOf } from '../../../_plugins/packages';
import { useNotify } from '../../../_ui/notify';

/** 패키지 화면을 콘솔 틀 안에 그린다. 없는 패키지면 안내 */
export function PackagePage({ plugin }: { plugin: string }) {
  const notify = useNotify();
  const entry = packageOf(plugin);
  if (!entry)
    return (
      <section className="console-inner" aria-label="기능 패키지">
        <div className="panel">
          <b>없는 메뉴</b>
          <p className="note">들어 있지 않은 패키지: {plugin}</p>
        </div>
      </section>
    );
  const { Page } = entry;
  return (
    <section className="console-inner wide" aria-label={entry.name}>
      <header className="page-head">
        <h1>{entry.name}</h1>
      </header>
      <Page call={callFor(plugin)} notify={notify} />
    </section>
  );
}
