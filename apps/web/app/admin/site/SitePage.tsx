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
      <section className="plugin" aria-label="백업">
        <div className="plugin-head">
          <div>
            <b>백업</b>
            <p>세션, 위키, 글을 보관 형식 zip으로 내려받기</p>
          </div>
        </div>
        <a className="ghost" href="/api/archive.zip" download>
          백업 받기
        </a>
      </section>
    </section>
  );
}
