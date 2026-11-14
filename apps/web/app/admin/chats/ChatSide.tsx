import Link from 'next/link';
import { CHAT_STATE, NEWS_KINDS, when } from '../../_task/labels';
import type { ChatDetail } from '../../_task/types';

/** 옆 칸에 보이는 최근 소식 수 (나머지는 위로 밀린다) */
const NEWS_SHOWN = 12;

// 대화의 옆 칸 (2차 1-4): 상태 · 목표 · 팀(팀원마다 지금 하는 일) · 소식 · 결과물. 좁은 화면에서는 대화 아래로 내려간다.
// 소식은 서버가 쌓은 것(agent_updates와 같다)을 최근 것부터 보인다. 글은 AI가 쓴 것이라 그대로 글자로만 그린다.
export function ChatSide({ detail }: { detail: ChatDetail }) {
  const { chat, team, news } = detail;
  const outputs = detail.turns.flatMap((t) => t.outputs);
  const approvals = detail.turns.flatMap((t) => t.approvalIds);
  const recent = news.slice(-NEWS_SHOWN).reverse();

  return (
    <aside className="chat-side" aria-label="대화의 진행">
      <section aria-labelledby="side-state">
        <h3 id="side-state">진행</h3>
        <p className="row">
          <span className={detail.state === 'working' ? 'pill strong' : 'pill'}>
            {CHAT_STATE[detail.state] ?? detail.state}
          </span>
          {detail.active > 0 && <small>도는 일 {detail.active}</small>}
          <small>회차 {chat.turns}</small>
        </p>
        {approvals.length > 0 && (
          <p className="note">
            결재 {approvals.length}건 · <Link href="/admin/approvals">결재 열기</Link>
          </p>
        )}
        {chat.goal && (
          <p className="side-line">
            <small>목표</small> {chat.goal}
          </p>
        )}
        {chat.project && (
          <p className="side-line">
            <small>프로젝트</small> <code>{chat.project}</code>
          </p>
        )}
      </section>
      <section aria-labelledby="side-team">
        <h3 id="side-team">팀</h3>
        <ul className="side-list">
          {team.map((m) => (
            <li key={m.id} style={{ paddingLeft: `${m.depth * 14}px` }}>
              <b>{m.name}</b>
              {m.lead && <span className="pill">대표</span>}
              <small>
                {m.paused
                  ? '멈춤'
                  : m.open > 0
                    ? `일하는 중${m.doing ? ` · ${m.doing}` : ''}`
                    : '대기'}
              </small>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="side-news">
        <h3 id="side-news">소식</h3>
        {recent.length === 0 ? (
          <p className="rows-empty">소식 없음</p>
        ) : (
          <ul className="side-list news">
            {recent.map((n) => (
              <li key={n.n}>
                <small>
                  {NEWS_KINDS[n.kind] ?? n.kind}
                  {n.agent ? ` · ${n.agent}` : ''} · {when(n.createdAt)}
                </small>
                <span className="clamp">{n.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {outputs.length > 0 && (
        <section aria-labelledby="side-outputs">
          <h3 id="side-outputs">결과물</h3>
          <ul className="side-list">
            {outputs.map((o) => (
              <li key={o.id}>
                <a href={`/api/outputs/${o.id}/file`} download={o.name}>
                  {o.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
