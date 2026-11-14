'use client';

import { useId, useRef, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import type { SkillDetail, SkillList, SkillSaved } from '../../_task/types';

const CONFLICT = '이미 바뀐 스킬이에요. 최신 내용을 다시 읽었어요';

const short = (hash: string) => hash.slice(0, 7);
const sourceOf = (s: { source: string; revision: number | null }) =>
  s.source === 'console' ? `콘솔 버전 ${s.revision}` : '저장소 버전';
const dateOf = (iso: string) => new Date(iso).toLocaleString('ko-KR');

// 스킬: 러너가 일할 때 따르는 지침(cairn-write 등). 저장소 판 위에 콘솔 판을 쌓고, 쓸 판을 골라 되돌린다.
// 저장하면 다음 작업부터 모든 러너가 그 판을 받는다 (서버가 일과 함께 실어 보낸다).
export function SkillPanel() {
  const skills = useLiveValue(
    'runner-skills',
    () => api<SkillList>('GET', '/api/runner-skills'),
    [],
  );
  const [open, setOpen] = useState<string | null>(null);
  const list = skills.data?.skills ?? null;
  const error = skills.error;

  return (
    <>
      <header className="page-head">
        <h1>스킬</h1>
      </header>
      <p className="note">
        러너가 일할 때 따르는 지침. 저장하면 다음 작업부터 모든 러너가 그 버전을 써요. 권한 · 결재 ·
        격리는 스킬로 바뀌지 않아요.
      </p>
      {error && <p className="error">{error}</p>}
      {list === null
        ? !error && <p className="label-mono">불러오는 중…</p>
        : list.map((skill) => (
            <section key={skill.name} className="plugin" aria-label={skill.name}>
              <div className="plugin-head">
                <div>
                  <b>{skill.name}</b>{' '}
                  <span className="label-mono">
                    {sourceOf(skill)} · {short(skill.hash)}
                  </span>
                  <p>{skill.description}</p>
                </div>
                <button
                  type="button"
                  className="ghost"
                  aria-expanded={open === skill.name}
                  onClick={() => setOpen(open === skill.name ? null : skill.name)}
                >
                  {open === skill.name ? '닫기' : '열기'}
                </button>
              </div>
              {skill.repoChanged && (
                <p className="warn">
                  저장소 버전이 바뀌었어요 (배포). 비교해서 필요한 것을 옮겨 주세요
                </p>
              )}
              {open === skill.name && <SkillEditor name={skill.name} onChanged={skills.reload} />}
            </section>
          ))}
    </>
  );
}

/** 스킬 하나: 지금 판 고치기, 저장소 판 보기, 판 목록과 되돌리기 */
function SkillEditor({ name, onChanged }: { name: string; onChanged: () => Promise<void> }) {
  const id = useId();
  const read = useLiveValue(
    `runner-skill:${name}`,
    () => api<SkillDetail>('GET', `/api/runner-skills/${name}`),
    [],
  );
  const action = useAction();
  // 고치는 중인 내용. 읽은 판이 바뀌면 버리고 읽은 내용으로 칸을 채운다 (저장 · 되돌리기 · 409 뒤)
  const [edited, setEdited] = useState<{ version: number; files: Record<string, string> } | null>(
    null,
  );
  const [file, setFile] = useState('SKILL.md');
  const [note, setNote] = useState('');
  const [showRepo, setShowRepo] = useState(false);
  // 응답을 놓쳐 다시 눌러도 판은 하나다. 저장이 끝나면 새로 만든다
  const requestId = useRef<string | null>(null);
  const detail = read.data;
  const problem = action.problem ?? read.error;
  const busy = action.busy !== null;

  if (detail === null) return problem ? <p className="error">{problem}</p> : null;
  const { version } = detail;
  const draft = edited?.version === version ? edited.files : detail.files;
  const changed = JSON.stringify(draft) !== JSON.stringify(detail.files);
  const files = Object.keys(draft).sort();
  /** 바뀐 뒤: 이 스킬과 목록을 다시 읽는다 */
  const reload = () => Promise.all([read.reload(), onChanged()]);

  async function save() {
    requestId.current ??= crypto.randomUUID();
    const body = { requestId: requestId.current, files: draft, note, version };
    const reply = await action.run(
      'save',
      () => api<SkillSaved>('POST', `/api/runner-skills/${name}/revisions`, body),
      { done: (saved) => `${name} 콘솔 버전 ${saved.revision} 저장`, reload, conflict: CONFLICT },
    );
    if (!reply?.ok) return;
    requestId.current = null;
    setNote('');
  }

  const use = (revision: number | null) =>
    action.run(
      `use:${revision}`,
      () => api<SkillSaved>('PUT', `/api/runner-skills/${name}/active`, { revision, version }),
      {
        done: `${name}: ${revision === null ? '저장소 버전' : `콘솔 버전 ${revision}`} 사용`,
        reload,
        conflict: CONFLICT,
      },
    );

  return (
    <div className="stack">
      {problem && <p className="error">{problem}</p>}
      <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="sr">파일</legend>
        {files.map((path) => (
          <button
            key={path}
            type="button"
            className="chip"
            aria-pressed={file === path}
            onClick={() => setFile(path)}
          >
            {path}
          </button>
        ))}
      </fieldset>
      <label className="sr" htmlFor={`${id}-text`}>
        {file}
      </label>
      <textarea
        id={`${id}-text`}
        className="input"
        rows={22}
        spellCheck={false}
        value={draft[file] ?? ''}
        onChange={(e) => setEdited({ version, files: { ...draft, [file]: e.target.value } })}
      />
      <div className="row">
        <label className="sr" htmlFor={`${id}-note`}>
          메모
        </label>
        <input
          id={`${id}-note`}
          className="input"
          placeholder="무엇을 왜 바꿨는지 (선택)"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" className="cta small" disabled={busy || !changed} onClick={save}>
          새 버전으로 저장
        </button>
        {changed && (
          <button type="button" className="ghost" disabled={busy} onClick={() => setEdited(null)}>
            변경 취소
          </button>
        )}
      </div>
      <button type="button" className="ghost" onClick={() => setShowRepo(!showRepo)}>
        {showRepo ? '저장소 버전 닫기' : '저장소 버전 보기'}
      </button>
      {showRepo && (
        <>
          <p className="label-mono">
            저장소 판 · {short(detail.repo.hash)} · {file}
          </p>
          <textarea
            className="input"
            rows={16}
            readOnly
            aria-label={`저장소 버전 ${file}`}
            value={detail.repo.files[file] ?? '(저장소 버전에 없는 파일)'}
          />
        </>
      )}
      <h2 className="label-mono">버전</h2>
      <ol className="list">
        <li className="list-cell row">
          <b>저장소 버전</b> <span className="label-mono">{short(detail.repo.hash)}</span>{' '}
          {detail.source === 'console' ? (
            <button type="button" className="ghost" disabled={busy} onClick={() => use(null)}>
              이 버전 사용
            </button>
          ) : (
            <span className="label-mono">쓰는 중</span>
          )}
        </li>
        {detail.revisionList.map((r) => (
          <li key={r.revision} className="list-cell row">
            <b>콘솔 버전 {r.revision}</b>{' '}
            <span className="label-mono">
              {dateOf(r.createdAt)} · {short(r.hash)}
            </span>
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
