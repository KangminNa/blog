import { type FormEvent, useCallback, useEffect, useState } from 'react';

// code-github의 콘솔 화면 (운영 › 코드). 코드 작업을 GitHub와 잇는다.
//   저장소: 등록 · 고치기 · 보관. 칸이 돌리는 명령(setup · checks)은 여기 적은 것만 쓴다
//   일 맡기기: 저장소 · 고칠 곳(paths) · 지시 · 담당. 코드 러너 칸이 고쳐 draft PR을 열고 결재를 올린다.
//     팀원이 있는 담당(팀장)은 경로로 나눠 팀원들에게 맡기고, 칸 수만큼 함께 돈다 (코드 작업 5단계)
//   PR: 러너가 연 PR. 주인이 GitHub에서 머지한 뒤 결재를 승인하면 작업이 끝난다
// 화면은 react와 이 폴더만 가져온다: 서버 호출(call)과 알림(notify)은 콘솔이 넘겨 준다.

type Reply = { ok: true; data: unknown } | { ok: false; message: string };
type Props = {
  call: (method: string, path: string, body?: object) => Promise<Reply>;
  notify: (text: string) => void;
};
type Repo = {
  id: string;
  name: string;
  url: string;
  base: string;
  setup: string;
  checks: string[];
  version: number;
};
/** 코어의 에이전트 (GET /api/agents, 코어 읽기). 담당 고르기에 쓰는 칸만 */
type Agent = { id: string; name: string; scopes: string[]; reportsTo: string | null };
type Pull = {
  id: string;
  repoName: string;
  taskId: string;
  number: number;
  url: string;
  branch: string;
  checks: { command: string; ok: boolean }[];
  status: string;
  version: number;
  updatedAt: string;
};

const STATUS: Record<string, string> = { open: '열림', merged: '머지 승인', closed: '닫힘' };

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export default function CodePage({ call, notify }: Props) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [pulls, setPulls] = useState<Pull[] | null>(null);
  const [coders, setCoders] = useState<Agent[]>([]);

  const load = useCallback(async () => {
    const [r, p, a] = await Promise.all([
      call('GET', 'repos'),
      call('GET', 'pulls'),
      call('GET', '/api/agents'),
    ]);
    if (r.ok) setRepos((r.data as { repos: Repo[] }).repos);
    else notify(r.message);
    if (p.ok) setPulls((p.data as { pulls: Pull[] }).pulls);
    else notify(p.message);
    // 코드 권한이 있는 에이전트만 담당이 될 수 있다
    if (a.ok)
      setCoders((a.data as { agents: Agent[] }).agents.filter((x) => x.scopes.includes('code')));
  }, [call, notify]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <p className="note">
        저장소를 등록하고 일을 맡기면 코드 러너 칸이 고쳐 draft PR을 열고 결재를 올려요. GitHub에서
        머지한 뒤 승인하면 작업이 끝나요. 토큰은 설정 › 플러그인 › code-github에 넣어요
      </p>
      <AddRepo call={call} notify={notify} onAdded={load} />
      {repos === null ? (
        <p className="note">불러오는 중</p>
      ) : repos.length === 0 ? (
        <p className="note">아직 등록한 저장소 없음</p>
      ) : (
        <ul className="list" aria-label="저장소">
          {repos.map((r) => (
            <RepoItem
              key={r.id}
              repo={r}
              coders={coders}
              call={call}
              notify={notify}
              onChanged={load}
            />
          ))}
        </ul>
      )}
      <Pulls pulls={pulls} />
    </div>
  );
}

function AddRepo({ call, notify, onAdded }: Props & { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [base, setBase] = useState('main');
  const [setup, setSetup] = useState('');
  const [checks, setChecks] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const reply = await call('POST', 'repos', { name, url, base, setup, checks: lines(checks) });
    setBusy(false);
    if (!reply.ok) return notify(reply.message);
    setName('');
    setUrl('');
    setSetup('');
    setChecks('');
    notify('저장소를 등록했어요');
    onAdded();
  }

  return (
    <form className="panel" onSubmit={add} aria-label="저장소 등록">
      <b>저장소 등록</b>
      <label className="field">
        <span>이름</span>
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>주소</span>
        <input
          type="url"
          required
          value={url}
          placeholder="https://github.com/me/app"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label className="field">
        <span>기준 브랜치</span>
        <input required maxLength={100} value={base} onChange={(e) => setBase(e.target.value)} />
      </label>
      <label className="field">
        <span>준비 명령 (setup, 선택)</span>
        <input
          maxLength={2000}
          value={setup}
          placeholder="pnpm install --frozen-lockfile"
          onChange={(e) => setSetup(e.target.value)}
        />
      </label>
      <label className="field">
        <span>검사 명령 (checks, 한 줄에 하나)</span>
        <textarea
          rows={3}
          value={checks}
          placeholder={'pnpm check\npnpm test'}
          onChange={(e) => setChecks(e.target.value)}
        />
      </label>
      <p className="note">
        명령은 칸 안에서 AI와 같은 사용자로 돌아요. 비밀값이 필요한 검사는 넣지 않아요
      </p>
      <button type="submit" className="cta small fit" disabled={busy}>
        등록
      </button>
    </form>
  );
}

/** 저장소 하나: 일 맡기기와 보관 */
function RepoItem({
  repo,
  coders,
  call,
  notify,
  onChanged,
}: Props & { repo: Repo; coders: Agent[]; onChanged: () => void }) {
  const [instruction, setInstruction] = useState('');
  const [paths, setPaths] = useState('');
  const [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const teamOf = (id: string) => coders.filter((c) => c.reportsTo === id).length;

  async function ask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const reply = await call('POST', `repos/${repo.id}/tasks`, {
      requestId: crypto.randomUUID(),
      instruction,
      paths: lines(paths),
      agentId: agentId || null,
    });
    setBusy(false);
    if (!reply.ok) return notify(reply.message);
    setInstruction('');
    notify('일을 맡겼어요. 작업 메뉴에서 진행을 볼 수 있어요');
  }

  async function archive() {
    const reply = await call('POST', `repos/${repo.id}/archive`, { version: repo.version });
    if (!reply.ok) return notify(reply.message);
    notify(`${repo.name} 보관함`);
    onChanged();
  }

  return (
    <li className="panel">
      <b>{repo.name}</b>
      <span className="label-mono">
        {repo.url} · {repo.base}
        {repo.setup ? ` · setup: ${repo.setup}` : ''}
        {repo.checks.length > 0 ? ` · checks: ${repo.checks.join(' / ')}` : ''}
      </span>
      <form className="stack" onSubmit={ask} aria-label={`${repo.name}에 일 맡기기`}>
        <label className="field">
          <span>맡길 일</span>
          <textarea
            required
            rows={5}
            value={instruction}
            placeholder="무엇을 왜 고칠지. 완료 기준이 있으면 함께"
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        <label className="field">
          <span>고칠 수 있는 곳 (한 줄에 하나, 저장소 전체는 .)</span>
          <textarea
            required
            rows={2}
            value={paths}
            placeholder={'src/billing\ndocs'}
            onChange={(e) => setPaths(e.target.value)}
          />
        </label>
        <label className="field">
          <span>담당</span>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">자동 배정 (코드 권한이 있는 에이전트)</option>
            {coders.map((c) => (
              <option key={c.id} value={c.id}>
                {teamOf(c.id) > 0 ? `${c.name} (팀원 ${teamOf(c.id)}명: 나눠 맡김)` : c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button type="submit" className="cta small" disabled={busy}>
            일 맡기기
          </button>
          <button type="button" className="ghost" onClick={archive}>
            보관
          </button>
        </div>
      </form>
    </li>
  );
}

/** 러너가 연 PR. 결재는 결재 메뉴에서 */
function Pulls({ pulls }: { pulls: Pull[] | null }) {
  return (
    <section className="panel" aria-label="PR">
      <b>PR</b>
      {pulls === null ? (
        <p className="note">불러오는 중</p>
      ) : pulls.length === 0 ? (
        <p className="note">아직 연 PR 없음</p>
      ) : (
        <ul className="list">
          {pulls.map((p) => (
            <li key={p.id} className="list-cell stack">
              <div className="row">
                <a href={p.url} target="_blank" rel="noreferrer">
                  {p.repoName} #{p.number}
                </a>
                <span className="label-mono">
                  {STATUS[p.status] ?? p.status} · 판 {p.version}
                </span>
                <a className="ghost" href={`/admin/tasks/${p.taskId}`}>
                  작업 열기
                </a>
              </div>
              {p.checks.length > 0 && (
                <small>
                  {p.checks.map((c) => `${c.ok ? '통과' : '실패'} ${c.command}`).join(' · ')}
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
