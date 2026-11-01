'use client';

import type { SpaceInfo } from '../../_lib/types';
import { useNotify } from '../AdminShell';
import { BlogForm } from './BlogForm';

export function SitePage({ space }: { space: SpaceInfo }) {
  const notify = useNotify();
  return (
    <section className="console-inner narrow" aria-label="사이트">
      <header className="page-head">
        <h1>사이트</h1>
      </header>
      <BlogForm
        space={space}
        submitLabel="저장"
        onSaved={() => notify('사이트 정보를 저장했어요')}
      />
    </section>
  );
}
