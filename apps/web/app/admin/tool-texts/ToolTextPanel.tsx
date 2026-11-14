'use client';

import { useRef, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import type { ToolTextDetail, ToolTextList, ToolTextSaved } from '../../_mcp/types';
import { ToolTextForm, type ToolTextSubmit } from './ToolTextForm';

const CONFLICT = '이미 바뀐 도구 설명이에요. 최신 내용을 다시 읽었어요';

const sourceOf = (t: { source: string; revision: number | null }) =>
  t.source === 'console' ? `콘솔 버전 ${t.revision}` : '기본';
/** 목록에 보일 첫 문장 (설명 전체는 열어서) */
const firstSentence = (text: string) => {
  const line = text.split('\n')[0] ?? '';
  const end = line.search(/[.。]\s/);
  return end > 0 ? line.slice(0, end + 1) : line;
};
const dateOf = (iso: string) => new Date(iso).toLocaleString('ko-KR');

// 도구 설명: AI 도구가 MCP로 받는 도구 설명과 입력 칸 설명. 기본 글(코드 밖 설명서 · 기능 패키지의 목록 파일) 위에
// 콘솔 버전을 쌓고, 쓸 버전을 골라 되돌린다. 저장하면 다음에 도구 목록을 받는 AI부터 그 글을 본다.
export function ToolTextPanel() {
  const tools = useLiveValue('tool-texts', () => api<ToolTextList>('GET', '/api/tool-texts'), []);
  const [open, setOpen] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const list = tools.data?.tools ?? null;
  const shown = list?.filter((t) => t.name.includes(find.trim())) ?? null;

  return (
    <>
      <header className="page-head">
        <h1>도구 설명</h1>
      </header>
      <p className="note">
        AI가 MCP 도구를 고를 때 읽는 글. 저장하면 다음에 도구 목록을 받는 AI부터 그 버전을 봐요.
        권한 · 결재 · 입력 형식은 설명으로 바뀌지 않아요.
      </p>
      <label className="sr" htmlFor="tool-text-find">
        도구 찾기
      </label>
      <input
        id="tool-text-find"
        className="input"
        placeholder="도구 이름으로 찾기"
        value={find}
        onChange={(e) => setFind(e.target.value)}
      />
      {tools.error && <p className="error">{tools.error}</p>}
      {shown === null
        ? !tools.error && <p className="label-mono">불러오는 중…</p>
        : shown.map((tool) => (
            <section key={tool.name} className="plugin" aria-label={tool.name}>
              <div className="plugin-head">
                <div>
                  <b>{tool.name}</b>{' '}
                  <span className="label-mono">
                    {tool.origin === 'plugin' ? '기능 패키지 · ' : ''}
                    {sourceOf(tool)}
                  </span>
                  <p>{firstSentence(tool.description)}</p>
                </div>
                <button
                  type="button"
                  className="ghost"
                  aria-expanded={open === tool.name}
                  onClick={() => setOpen(open === tool.name ? null : tool.name)}
                >
                  {open === tool.name ? '닫기' : '열기'}
                </button>
              </div>
              {tool.defaultChanged && (
                <p className="warn">
                  기본 글이 바뀌었어요 (배포). 비교해서 필요한 것을 옮겨 주세요
                </p>
              )}
              {open === tool.name && <ToolTextEditor name={tool.name} onChanged={tools.reload} />}
            </section>
          ))}
    </>
  );
}

/** 도구 하나: 지금 글 고치기, 기본 글 보기, 버전 목록과 되돌리기 */
function ToolTextEditor({ name, onChanged }: { name: string; onChanged: () => Promise<void> }) {
  const read = useLiveValue(
    `tool-text:${name}`,
    () => api<ToolTextDetail>('GET', `/api/tool-texts/${name}`),
    [],
  );
  const action = useAction();
  const [showDefault, setShowDefault] = useState(false);
  // 응답을 놓쳐 다시 눌러도 버전은 하나다. 저장이 끝나면 새로 만든다
  const requestId = useRef<string | null>(null);
  const detail = read.data;
  const problem = action.problem ?? read.error;
  const busy = action.busy !== null;

  if (detail === null) return problem ? <p className="error">{problem}</p> : null;
  const { version } = detail;
  /** 바뀐 뒤: 이 도구와 목록을 다시 읽는다 */
  const reload = () => Promise.all([read.reload(), onChanged()]);

  async function save(text: ToolTextSubmit) {
    requestId.current ??= crypto.randomUUID();
    const body = { requestId: requestId.current, version, ...text };
    const reply = await action.run(
      'save',
      () => api<ToolTextSaved>('POST', `/api/tool-texts/${name}/revisions`, body),
      { done: (saved) => `${name} 콘솔 버전 ${saved.revision} 저장`, reload, conflict: CONFLICT },
    );
    if (reply?.ok) requestId.current = null;
  }

  const use = (revision: number | null) =>
    action.run(
      `use:${revision}`,
      () => api<ToolTextSaved>('PUT', `/api/tool-texts/${name}/active`, { revision, version }),
      {
        done: `${name}: ${revision === null ? '기본 글' : `콘솔 버전 ${revision}`} 사용`,
        reload,
        conflict: CONFLICT,
      },
    );

  return (
    <div className="stack">
      {problem && <p className="error">{problem}</p>}
      <ToolTextForm key={version} detail={detail} busy={busy} onSubmit={save} />
      <button type="button" className="ghost" onClick={() => setShowDefault(!showDefault)}>
        {showDefault ? '기본 글 닫기' : '기본 글 보기'}
      </button>
      {showDefault && (
        <dl className="kv">
          <dt>설명</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{detail.default.description}</dd>
          {detail.fields.map((f) => (
            <div key={f.path} style={{ display: 'contents' }}>
              <dt className="label-mono">{f.path}</dt>
              <dd>{detail.default.input[f.path] ?? '(없음)'}</dd>
            </div>
          ))}
        </dl>
      )}
      <h2 className="label-mono">버전</h2>
      <ol className="list">
        <li className="list-cell row">
          <b>기본</b>{' '}
          {detail.source === 'console' ? (
            <button type="button" className="ghost" disabled={busy} onClick={() => use(null)}>
              기본으로
            </button>
          ) : (
            <span className="label-mono">쓰는 중</span>
          )}
        </li>
        {detail.revisionList.map((r) => (
          <li key={r.revision} className="list-cell row">
            <b>콘솔 버전 {r.revision}</b> <span className="label-mono">{dateOf(r.createdAt)}</span>
            {r.note && <span> · {r.note}</span>}{' '}
            {detail.revision === r.revision ? (
              <span className="label-mono">쓰는 중</span>
            ) : (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => use(r.revision)}
              >
                이 버전 사용
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
