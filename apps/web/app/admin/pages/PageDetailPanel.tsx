'use client';

import Link from 'next/link';
import { useState } from 'react';
import { pagePath } from '../../_blog/format';
import { usePage } from '../../_blog/live';
import type { PageDetail, PageRevision } from '../../_blog/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { when } from '../../_task/labels';
import { usePageTasks } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Output, OutputPage, Task } from '../../_task/types';
import { PageAskForm } from './PageAskForm';
import { PageTitleForm } from './PageTitleForm';

const CONFLICT = '이미 바뀐 페이지예요. 최신 내용을 다시 읽었어요';
/** 서버가 붙이는 격리와 같다 (틀에도 한 번 더): 페이지의 스크립트는 콘솔과 로그인에 닿지 못한다 */
const FRAME_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';
const ENTRY = 'index.html';
/** 만들기 작업이 받는 재료의 수 */
const MATERIALS_MAX = 10;
/** 보이는 판의 파일을 찾지 못했다. 서버에 보내지 않고 이 오류로 멈춘다 */
const NO_FILES = {
  ok: false,
  status: 0,
  error: {
    code: 'no_files',
    message: '보이는 판의 파일이 결과물에 없어요. 결과물의 휴지통에서 되살린 뒤 다시 해 주세요',
  },
} as const;

/** 고칠 때 넘길 재료: 그 판을 만든 실행의 파일. 문(index.html)을 맨 앞에, 받는 수까지만 */
function materialsOf(outputs: readonly Output[]): string[] {
  const last = Math.max(0, ...outputs.map((o) => o.runSeq ?? 0));
  return outputs
    .filter((o) => o.runSeq === last)
    .sort((a, b) => Number(b.name === ENTRY) - Number(a.name === ENTRY))
    .slice(0, MATERIALS_MAX)
    .map((o) => o.id);
}

// 페이지 하나: 왼쪽에 지금 보이는 판, 오른쪽에 고쳐 달라는 입력 · 공개 · 판 목록.
// 고쳐 달라고 하면 보이는 판의 파일을 재료로 만들기 작업이 돌고, 끝나면 새 판이 곧바로 보인다. 앞 판은 남아서 되돌릴 수 있다.
export function PageDetailPanel({ id }: { id: string }) {
  const page = usePage(id);
  const making = usePageTasks();
  const action = useAction();
  const save = useAction();
  const ask = useAction();
  const [renaming, setRenaming] = useState(false);
  const p = page.data;
  const problem = action.problem ?? page.error ?? making.error;

  if (!p)
    return problem ? (
      <p className="error">{problem}</p>
    ) : (
      <p className="label-mono">불러오는 중…</p>
    );

  const path = pagePath(p.name);
  const fixing = making.tasks.filter((t) => t.page?.pageId === p.id);

  async function fix(shown: PageDetail, instruction: string, requestId: string) {
    const current = shown.revisionList.find((r) => r.seq === shown.currentSeq);
    if (!current) return false;
    const reply = await ask.run(
      'ask',
      async () => {
        const files = await api<OutputPage>('GET', `/api/outputs?taskId=${current.taskId}`);
        if (!files.ok) return files;
        const outputIds = materialsOf(files.data.outputs);
        if (outputIds.length === 0) return NO_FILES;
        return api<Task>('POST', '/api/tasks', {
          requestId,
          kind: 'make',
          instruction,
          page: { pageId: shown.id },
          materials: { outputIds, wikiIds: [] },
        });
      },
      { done: '작업 등록됨' },
    );
    return reply?.ok === true;
  }

  async function rename(shown: PageDetail, title: string) {
    const reply = await save.run(
      'title',
      () => api('PATCH', `/api/pages/${shown.id}`, { version: shown.version, title }),
      { done: '제목 저장됨', reload: page.reload, conflict: CONFLICT },
    );
    if (reply?.ok) setRenaming(false);
  }

  function toggle(shown: PageDetail) {
    const visibility = shown.visibility === 'public' ? 'private' : 'public';
    if (visibility === 'public' && !window.confirm('주소를 아는 누구나 보게 할까요?')) return;
    void action.run(
      'visibility',
      () => api('PATCH', `/api/pages/${shown.id}`, { version: shown.version, visibility }),
      {
        done: visibility === 'public' ? '공개로 바꿈' : '비공개로 바꿈',
        reload: page.reload,
        conflict: CONFLICT,
      },
    );
  }

  const show = (shown: PageDetail, r: PageRevision) =>
    action.run(
      `seq:${r.seq}`,
      () => api('POST', `/api/pages/${shown.id}/current`, { version: shown.version, seq: r.seq }),
      { done: `판 ${r.seq} 보이는 중`, reload: page.reload, conflict: CONFLICT },
    );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{p.title}</h1>
          <p>
            <Link href="/admin/pages">페이지</Link> · /pages/{p.name}
          </p>
        </div>
        <div className="row">
          {!renaming && (
            <button type="button" className="ghost" onClick={() => setRenaming(true)}>
              제목 고치기
            </button>
          )}
          <a className="ghost" href={path} target="_blank" rel="noreferrer">
            새 탭에서 열기
          </a>
        </div>
      </header>
      {problem && <p className="error">{problem}</p>}
      {renaming && (
        <PageTitleForm
          key={p.version}
          title={p.title}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={(title) => rename(p, title)}
          onClose={() => {
            setRenaming(false);
            save.clear();
          }}
        />
      )}
      <div className="page-work">
        <iframe
          key={`${p.currentSeq}:${p.updatedAt}`}
          className="page-frame"
          title={p.title}
          src={`${path}/${ENTRY}`}
          sandbox={FRAME_SANDBOX}
        />
        <div className="stack">
          <PageAskForm
            label="고칠 내용"
            placeholder="예: 둘째 날은 실내 코스로 바꿔 줘"
            submit="고치기"
            busy={ask.busy !== null}
            problem={ask.problem}
            onSubmit={(instruction, requestId) => fix(p, instruction, requestId)}
            onEdit={ask.clear}
          />
          {fixing.length > 0 && (
            <ul className="list" aria-label="고치는 중">
              {fixing.map((t) => (
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
          )}
          <section className="plugin" aria-label="공개">
            <div className="plugin-head">
              <div>
                <b>공개</b>
                <p>{p.visibility === 'public' ? '주소를 아는 누구나 봄' : '로그인한 나만 봄'}</p>
              </div>
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={p.visibility === 'public'}
                aria-label="공개"
                disabled={action.busy !== null}
                onClick={() => toggle(p)}
              />
            </div>
          </section>
          <section aria-labelledby="page-revisions">
            <div className="sec-title">
              <h2 id="page-revisions">판</h2>
            </div>
            <ul className="list">
              {p.revisionList.map((r) => (
                <li key={r.seq} className="list-cell schedule-row">
                  <div className="item-main">
                    <b>
                      판 {r.seq}{' '}
                      {r.seq === p.currentSeq && <span className="pill on">보이는 판</span>}
                    </b>
                    <small>
                      {when(r.createdAt)} · 파일 {r.files.length}개 ·{' '}
                      <Link href={`/admin/tasks/${r.taskId}`}>작업</Link>
                    </small>
                    {r.note && <small className="clamp">{r.note}</small>}
                  </div>
                  {r.seq !== p.currentSeq && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={action.busy !== null}
                      onClick={() => show(p, r)}
                    >
                      이 판 보이기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
