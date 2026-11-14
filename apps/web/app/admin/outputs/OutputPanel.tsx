'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { bytes, INLINE_MIMES, OUTPUT_KINDS, TEXT_MIMES, when } from '../../_task/labels';
import { readPages } from '../../_task/live';
import { isHtmlOutput, OutputOpen } from '../../_task/parts';
import type { Output, OutputPage, OutputSaved, OutputUsage, Task } from '../../_task/types';
import { type MakeBody, MakeForm } from './MakeForm';

type Tab = 'all' | 'trash' | keyof typeof OUTPUT_KINDS;

const TABS: readonly [Tab, string][] = [
  ['all', '전체'],
  ...Object.entries(OUTPUT_KINDS).map(([kind, label]) => [kind, label] as [Tab, string]),
  ['trash', '휴지통'],
];
/** 만들기 작업의 재료 결과물 한도 (서버의 MakeMaterials.MAX) */
const MATERIALS_MAX = 10;
/** 글자로 미리 볼 수 있는 크기 */
const TEXT_PREVIEW_MAX = 1024 * 1024;

const fileUrl = (output: Output, inline = false) =>
  `/api/outputs/${output.id}/file${inline ? '?inline=1' : ''}`;
const previewable = (o: Output) =>
  INLINE_MIMES.includes(o.mime) || (TEXT_MIMES.includes(o.mime) && o.sizeBytes <= TEXT_PREVIEW_MAX);
/** 더 읽은 쪽을 앞 쪽 뒤에 잇는다. 쓰는 공간은 새로 읽은 값 */
const mergePages = (before: OutputPage, more: OutputPage): OutputPage => ({
  ...more,
  outputs: [...before.outputs, ...more.outputs],
});

// 결과물: AI가 작업에서 만든 파일 (러너가 일이 끝난 뒤 올린다). 내려받기 · 미리 보기 · 휴지통.
// 파일은 늘 내려받기로 주고, 미리 보기는 서버가 앞부분으로 확인한 그림 · PDF · 영상과 글자 파일만 연다.
// 만들기: 고른 결과물 · 위키를 재료로 칸의 AI에게 PPT · 문서 · 영상을 맡긴다. 고쳐 달라는 그 결과물을 재료로 한 새 작업이다.
export function OutputPanel({ taskId }: { taskId: string | null }) {
  const [tab, setTab] = useState<Tab>('all');
  /** 읽어 둔 쪽 수. 종류를 바꾸면 처음으로 돌아간다 */
  const pages = useRef(1);
  const [open, setOpen] = useState<Output | null>(null);
  const action = useAction();
  const make = useAction();
  /** 만들기 폼이 열렸는가, 재료로 고른 결과물, 고쳐 달라로 열렸으면 그 결과물 */
  const [making, setMaking] = useState(false);
  const [materials, setMaterials] = useState<readonly Output[]>([]);
  const [revising, setRevising] = useState<Output | null>(null);

  const query = new URLSearchParams();
  if (tab === 'trash') query.set('trash', '1');
  else if (tab !== 'all') query.set('kind', tab);
  if (taskId) query.set('taskId', taskId);
  const filter = query.toString();
  const path = filter ? `/api/outputs?${filter}` : '/api/outputs';
  const list = useLiveValue(path, () => readPages(path, pages.current, mergePages), []);
  const page = list.data;
  const error = action.problem ?? list.error;
  const busy = action.busy !== null;

  async function act(output: Output, verb: 'delete' | 'restore' | 'purge', done: string) {
    const reply = await action.run(
      output.id,
      () =>
        api<OutputSaved>('POST', `/api/outputs/${output.id}/${verb}`, { version: output.version }),
      {
        done: `${output.name} ${done}`,
        reload: list.reload,
        conflict: '이미 바뀐 결과물이에요. 최신 목록을 다시 읽었어요',
      },
    );
    if (reply?.ok && open?.id === output.id) setOpen(null);
  }

  // 만들기 작업은 패널이 맡긴다 (폼은 칸만). 됐으면 그 작업
  async function submitMake(body: MakeBody, requestId: string) {
    const reply = await make.run('make', () =>
      api<Task>('POST', '/api/tasks', { requestId, ...body }),
    );
    return reply?.ok ? reply.data : null;
  }

  function startMaking(from: Output | null) {
    make.clear();
    setMaking(true);
    setRevising(from);
    setMaterials(from ? [from] : []);
  }

  const addMaterial = (o: Output) =>
    setMaterials((before) =>
      before.some((m) => m.id === o.id) || before.length >= MATERIALS_MAX ? before : [...before, o],
    );

  return (
    <>
      <header className="page-head">
        <h1>결과물</h1>
        {!making && (
          <button type="button" className="cta small" onClick={() => startMaking(null)}>
            만들기
          </button>
        )}
      </header>
      <p className="note">
        AI가 작업에서 만든 파일. 러너가 일이 끝난 뒤 올려요. 지우면 휴지통에 30일 있다가 사라져요.
      </p>
      {page && <Usage usage={page.usage} />}
      {taskId && (
        <p className="note">
          한 작업의 결과물만 보는 중 · <Link href={`/admin/tasks/${taskId}`}>작업 열기</Link> ·{' '}
          <Link href="/admin/outputs">전체 보기</Link>
        </p>
      )}
      <div className="row" role="tablist" aria-label="결과물 종류">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="chip"
            aria-selected={tab === id}
            onClick={() => {
              setOpen(null);
              pages.current = 1;
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {making && (
        <MakeForm
          materials={materials}
          onRemove={(o) => setMaterials((before) => before.filter((m) => m.id !== o.id))}
          revising={revising}
          busy={make.busy !== null}
          problem={make.problem}
          onSubmit={submitMake}
          onClear={make.clear}
          onClose={() => {
            setMaking(false);
            setRevising(null);
            setMaterials([]);
          }}
        />
      )}
      {error && <p className="error">{error}</p>}
      {open && <Preview output={open} onClose={() => setOpen(null)} />}
      {page === null ? (
        !error && <p className="label-mono">불러오는 중…</p>
      ) : page.outputs.length === 0 ? (
        <p className="rows-empty">{tab === 'trash' ? '휴지통이 비었어요' : '결과물 없음'}</p>
      ) : (
        <ul className="list" aria-label="결과물">
          {page.outputs.map((o) => (
            <li key={o.id} className="list-cell output-row">
              {o.kind === 'image' && INLINE_MIMES.includes(o.mime) ? (
                // biome-ignore lint/performance/noImgElement: 주인만 받는 파일이라 Next의 이미지 최적화를 거치지 않는다
                <img className="output-thumb" src={fileUrl(o, true)} alt="" loading="lazy" />
              ) : (
                <span className="output-thumb label-mono" aria-hidden="true">
                  {o.name.split('.').pop()?.slice(0, 4) ?? ''}
                </span>
              )}
              <div className="output-main">
                <b>{o.name}</b>
                <small>
                  {OUTPUT_KINDS[o.kind] ?? o.kind} · {bytes(o.sizeBytes)} ·{' '}
                  {o.taskId ? (
                    <>
                      <Link href={`/admin/tasks/${o.taskId}`}>{o.taskTitle}</Link> {o.runSeq}회
                    </>
                  ) : (
                    '올린 파일'
                  )}{' '}
                  · {when(o.createdAt)}
                </small>
              </div>
              <div className="row">
                {previewable(o) && (
                  <button type="button" className="ghost" onClick={() => setOpen(o)}>
                    미리 보기
                  </button>
                )}
                {isHtmlOutput(o.name) && <OutputOpen id={o.id} name={o.name} />}
                <a className="ghost" href={fileUrl(o)} download={o.name}>
                  내려받기
                </a>
                {o.deletedAt ? (
                  <>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => act(o, 'restore', '복원됨')}
                    >
                      복원
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => act(o, 'purge', '영구 삭제')}
                    >
                      바로 지우기
                    </button>
                  </>
                ) : (
                  <>
                    {making ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={
                          materials.some((m) => m.id === o.id) || materials.length >= MATERIALS_MAX
                        }
                        onClick={() => addMaterial(o)}
                      >
                        {materials.some((m) => m.id === o.id) ? '재료' : '재료로'}
                      </button>
                    ) : (
                      <button type="button" className="ghost" onClick={() => startMaking(o)}>
                        수정 요청
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => act(o, 'delete', '휴지통으로')}
                    >
                      지우기
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {page?.next && (
        <button
          type="button"
          className="ghost wide"
          onClick={() => {
            pages.current += 1;
            void list.reload();
          }}
        >
          더 보기
        </button>
      )}
    </>
  );
}

/** 결과물이 쓰는 공간. 한도의 90%나 디스크 여유에 가까우면 알린다 */
function Usage({ usage }: { usage: OutputUsage }) {
  const full = usage.usedBytes >= usage.maxBytes * 0.9;
  const low = usage.diskFreeBytes < usage.reserveBytes * 1.2;
  return (
    <>
      <p className="label-mono">
        {bytes(usage.usedBytes)} / {bytes(usage.maxBytes)} 사용 · 디스크 여유{' '}
        {bytes(usage.diskFreeBytes)}
      </p>
      {full && (
        <p className="warn">결과물 공간이 거의 찼어요. 휴지통을 비우거나 한도를 늘려 주세요</p>
      )}
      {low && (
        <p className="warn">
          서버 디스크 여유가 적어요. {bytes(usage.reserveBytes)} 밑으로는 결과물을 받지 않아요
        </p>
      )}
    </>
  );
}

/** 미리 보기. 그림 · 영상은 바로, PDF는 새 탭, 글자 파일은 글자로만 (HTML로 그리지 않는다) */
function Preview({ output, onClose }: { output: Output; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const isText = TEXT_MIMES.includes(output.mime);

  useEffect(() => {
    if (!isText) return;
    let alive = true;
    void fetch(fileUrl(output))
      .then((res) => (res.ok ? res.text() : '읽지 못했어요'))
      .then((body) => alive && setText(body));
    return () => {
      alive = false;
    };
  }, [output, isText]);

  return (
    <section className="panel" aria-label={`미리 보기: ${output.name}`}>
      <div className="sec-title flat">
        <h2>{output.name}</h2>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      {output.mime.startsWith('image/') && (
        // biome-ignore lint/performance/noImgElement: 주인만 받는 파일이라 Next의 이미지 최적화를 거치지 않는다
        <img className="output-preview" src={fileUrl(output, true)} alt={output.name} />
      )}
      {output.mime.startsWith('video/') && (
        // biome-ignore lint/a11y/useMediaCaption: AI가 만든 영상에는 자막 파일이 없다
        <video className="output-preview" src={fileUrl(output, true)} controls />
      )}
      {output.mime === 'application/pdf' && (
        <a className="ghost" href={fileUrl(output, true)} target="_blank" rel="noreferrer">
          새 탭에서 열기
        </a>
      )}
      {isText && <pre className="raw">{text ?? '불러오는 중…'}</pre>}
    </section>
  );
}
