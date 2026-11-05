'use client';

import type { SpaceInfo } from '../../_account/types';
import { useNotify } from '../AdminShell';
import { BlogForm } from './BlogForm';

// 사이트 정보(이름·소개·주소)와 백업 받기. 틀(제목)은 page.tsx에 있다.
export function SitePanel({ space }: { space: SpaceInfo }) {
  const notify = useNotify();
  return (
    <>
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
    </>
  );
}
