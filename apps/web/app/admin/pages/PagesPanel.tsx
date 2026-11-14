'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePages } from '../../_blog/live';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { when } from '../../_task/labels';
import { usePageTasks } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Task } from '../../_task/types';
import { PageAskForm } from './PageAskForm';

// 페이지: AI가 만든 HTML 묶음. 만들어 달라고 하면 작업이 돌고, 끝나면 바로 주소가 생긴다 (공개로 바꾸기 전에는 나만 본다).
// watch: 방금 맡긴 작업. 그 작업이 만든 페이지가 생기면 그 페이지를 연다.
export function PagesPanel({ watch }: { watch: string | null }) {
  const router = useRouter();
  const pages = usePages();
  const making = usePageTasks();
  const ask = useAction();
  const list = pages.data?.pages ?? null;
  const problem = pages.error ?? making.error;
  const made = watch === null ? null : (list?.find((p) => p.lastTaskId === watch) ?? null);

  useEffect(() => {
    if (made) router.replace(`/admin/pages/${made.id}`);
  }, [made, router]);

  async function create(instruction: string, requestId: string) {
    const reply = await ask.run(
      'ask',
      () => api<Task>('POST', '/api/tasks', { requestId, kind: 'make', instruction, page: {} }),
      { done: '작업 등록됨' },
    );
    if (reply?.ok) router.replace(`/admin/pages?task=${reply.data.id}`);
    return reply?.ok === true;
  }

  return (
    <>
      <header className="page-head">
        <h1>페이지</h1>
      </header>
      <p className="note">
        물으면 AI가 찾아보고 웹 페이지로 답해요. 끝나면 바로 주소가 생기고, 공개로 바꾸기 전에는
        로그인한 나만 봐요
      </p>
      <PageAskForm
        label="만들 페이지"
        placeholder="예: 이번 주말 서울 데이트 코스를 지도로 짜 줘"
        submit="만들기"
        busy={ask.busy !== null}
        problem={ask.problem}
        onSubmit={create}
        onEdit={ask.clear}
      />
      {problem && <p className="error">{problem}</p>}
      {watch && !made && (
        <p className="note" role="status">
          끝나면 페이지가 열려요 · <Link href={`/admin/tasks/${watch}`}>작업 보기</Link>
        </p>
      )}
      {making.tasks.length > 0 && (
        <section aria-labelledby="pages-making">
          <div className="sec-title">
            <h2 id="pages-making">만드는 중</h2>
          </div>
          <ul className="list">
            {making.tasks.map((t) => (
              <li key={t.id}>
                <Link className="item" href={`/admin/tasks/${t.id}`}>
                  <div className="item-main">
                    <b>{t.title}</b>
                    <small>{t.lastEvent ?? when(t.createdAt)}</small>
                  </div>
                  <TaskPill status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {list === null ? (
        !problem && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">페이지 없음</p>
      ) : (
        <ul className="list" aria-label="페이지">
          {list.map((p) => (
            <li key={p.id}>
              <Link className="item" href={`/admin/pages/${p.id}`}>
                <div className="item-main">
                  <b>{p.title}</b>
                  <small>
                    /pages/{p.name} · 버전 {p.currentSeq}/{p.revisions} · {when(p.updatedAt)}
                  </small>
                </div>
                <span className={p.visibility === 'public' ? 'pill on' : 'pill'}>
                  {p.visibility === 'public' ? '공개' : '비공개'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
