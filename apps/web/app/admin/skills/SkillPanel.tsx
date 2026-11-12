'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import type { SkillDetail, SkillList, SkillSaved, SkillSummary } from '../../_task/types';
import { useNotify } from '../../_ui/notify';

const short = (hash: string) => hash.slice(0, 7);
const sourceOf = (s: { source: string; revision: number | null }) =>
  s.source === 'console' ? `콘솔 판 ${s.revision}` : '저장소 판';
const dateOf = (iso: string) => new Date(iso).toLocaleString('ko-KR');

// 스킬: 러너가 일할 때 따르는 지침(cairn-write 등). 저장소 판 위에 콘솔 판을 쌓고, 쓸 판을 골라 되돌린다.
// 저장하면 다음 작업부터 모든 러너가 그 판을 받는다 (서버가 일과 함께 실어 보낸다).
export function SkillPanel() {
  const [list, setList] = useState<SkillSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const reply = await api<SkillList>('GET', '/api/runner-skills');
    if (!reply.ok) return setError(describe(reply.error));
    setError(null);
    setList(reply.data.skills);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header className="page-head">
        <h1>스킬</h1>
      </header>
      <p className="note">
        러너가 일할 때 따르는 지침. 저장하면 다음 작업부터 모든 러너가 그 판을 써요. 권한 · 결재 ·
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
                  저장소 판이 바뀌었어요 (배포). 비교해서 필요한 것을 옮겨 주세요
                </p>
              )}
              {open === skill.name && <SkillEditor name={skill.name} onChanged={load} />}
            </section>
          ))}
    </>
  );
}

/** 스킬 하나: 지금 판 고치기, 저장소 판 보기, 판 목록과 되돌리기 */
function SkillEditor({ name, onChanged }: { name: string; onChanged: () => Promise<void> }) {
  const id = useId();
  const notify = useNotify();
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [file, setFile] = useState('SKILL.md');
  const [note, setNote] = useState('');
  const [showRepo, setShowRepo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 응답을 놓쳐 다시 눌러도 판은 하나다. 저장이 끝나면 새로 만든다
  const requestId = useRef<string | null>(null);

  const load = useCallback(async () => {
    const reply = await api<SkillDetail>('GET', `/api/runner-skills/${name}`);
    if (!reply.ok) return setProblem(describe(reply.error));
    setDetail(reply.data);
    setDraft(reply.data.files);
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  if (detail === null) return problem ? <p className="error">{problem}</p> : null;
  const changed = JSON.stringify(draft) !== JSON.stringify(detail.files);
  const files = Object.keys(draft).sort();

  /** 바뀐 뒤: 이 스킬과 목록을 다시 읽고 알린다 */
  async function done(text: string) {
    await Promise.all([load(), onChanged()]);
    setBusy(false);
    notify(text);
  }

  async function save() {
    if (!detail) return;
    setBusy(true);
    setProblem(null);
    requestId.current ??= crypto.randomUUID();
    const reply = await api<SkillSaved>('POST', `/api/runner-skills/${name}/revisions`, {
      requestId: requestId.current,
      files: draft,
      note,
      version: detail.version,
    });
    if (!reply.ok) {
      setBusy(false);
      if (reply.status === 409) {
        await load();
        return setProblem('이미 바뀐 스킬이에요. 최신 내용을 다시 읽었어요');
      }
      return setProblem(describe(reply.error));
    }
    requestId.current = null;
    setNote('');
    await done(`${name} 콘솔 판 ${reply.data.revision} 저장`);
  }

  async function use(revision: number | null) {
    if (!detail) return;
    setBusy(true);
    setProblem(null);
    const reply = await api<SkillSaved>('PUT', `/api/runner-skills/${name}/active`, {
      revision,
      version: detail.version,
    });
    if (!reply.ok) {
      setBusy(false);
      await load();
      return setProblem(
        reply.status === 409
          ? '이미 바뀐 스킬이에요. 최신 내용을 다시 읽었어요'
          : describe(reply.error),
      );
    }
    await done(`${name}: ${revision === null ? '저장소 판' : `콘솔 판 ${revision}`} 사용`);
  }

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
        onChange={(e) => setDraft({ ...draft, [file]: e.target.value })}
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
          새 판으로 저장
        </button>
        {changed && (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => setDraft(detail.files)}
          >
            되돌리기
          </button>
        )}
      </div>
      <button type="button" className="ghost" onClick={() => setShowRepo(!showRepo)}>
        {showRepo ? '저장소 판 닫기' : '저장소 판 보기'}
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
            aria-label={`저장소 판 ${file}`}
            value={detail.repo.files[file] ?? '(저장소 판에 없는 파일)'}
          />
        </>
      )}
      <h2 className="label-mono">판</h2>
      <ol className="list">
        <li className="list-cell row">
          <b>저장소 판</b> <span className="label-mono">{short(detail.repo.hash)}</span>{' '}
          {detail.source === 'console' ? (
            <button type="button" className="ghost" disabled={busy} onClick={() => use(null)}>
              이 판 쓰기
            </button>
          ) : (
            <span className="label-mono">쓰는 중</span>
          )}
        </li>
        {detail.revisionList.map((r) => (
          <li key={r.revision} className="list-cell row">
            <b>콘솔 판 {r.revision}</b>{' '}
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
                이 판 쓰기
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
