import Link from 'next/link';
import { holdLabel, TOOL_LABELS, tokens, WINDOW_LABELS, when } from './labels';
import type { Agent, Usage, UsageAgent, UsageWindow } from './types';

/** 값 한 줄과 막대. 글자가 값을 말하므로 막대는 읽어 주지 않는다. percent가 없으면 막대도 없다 */
function Meter({
  label,
  value,
  percent,
  full = false,
}: {
  label: string;
  value: string;
  percent?: number;
  full?: boolean;
}) {
  return (
    <div className="usage">
      <div className="usage-text">
        <span>{label}</span>
        <span className={full ? 'mono strong' : 'mono'}>{value}</span>
      </div>
      {percent !== undefined && (
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      )}
    </div>
  );
}

/** 구독 창 하나. 값이 없거나 초기화 시각이 지났으면 확인 전 */
function PlanMeter({ row }: { row: UsageWindow }) {
  const label = WINDOW_LABELS[row.window] ?? row.window;
  if (row.percent === null || row.resetsAt === null)
    return <Meter label={label} value="확인 전" percent={0} />;
  return (
    <Meter
      label={label}
      value={`${row.percent}% · ${when(row.resetsAt)} 초기화`}
      percent={row.percent}
      full={row.percent >= 100}
    />
  );
}

function TokenMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  if (limit === null) return <Meter label={label} value={`${tokens(used)} 토큰 · 한도 없음`} />;
  return (
    <Meter
      label={label}
      value={`${tokens(used)} / ${tokens(limit)} 토큰`}
      percent={Math.round((used / limit) * 100)}
      full={used >= limit}
    />
  );
}

function AgentMeters({ row, name }: { row: UsageAgent; name: string }) {
  const hold = holdLabel(row);
  return (
    <li className="usage-agent">
      <div className="usage-head">
        <b>{name}</b>
        {hold && <span className="pill strong">{hold}</span>}
      </div>
      <TokenMeter label="5시간" used={row.fiveHourTokens} limit={row.fiveHourLimit} />
      <TokenMeter label="이번 달" used={row.monthTokens} limit={row.monthlyLimit} />
    </li>
  );
}

// 홈의 사용량: 구독 사용률과 에이전트별 토큰. 상태는 굵기와 채움으로만 구분한다.
export function UsageBlock({
  usage,
  agents,
}: {
  usage: Usage | null;
  agents: readonly Agent[] | undefined;
}) {
  const tools = [...new Set(usage?.plan.map((row) => row.tool))];
  const names = new Map(agents?.map((a) => [a.id, a.name]));
  return (
    <section aria-labelledby="home-usage">
      <div className="sec-title">
        <h2 id="home-usage">사용량</h2>
        <Link href="/admin/agents">한도 설정</Link>
      </div>
      {usage === null ? (
        <p className="rows-empty">불러오는 중…</p>
      ) : usage.agents.length === 0 ? (
        <p className="rows-empty">사용량 없음</p>
      ) : (
        <div className="two">
          <div className="panel">
            {tools.map((tool) => (
              <div key={tool} className="usage-agent">
                <div className="usage-head">
                  <b>{TOOL_LABELS[tool] ?? tool} 구독</b>
                </div>
                {usage.plan
                  .filter((row) => row.tool === tool)
                  .map((row) => (
                    <PlanMeter key={row.window} row={row} />
                  ))}
              </div>
            ))}
          </div>
          <ul className="panel usage-agents">
            {usage.agents.map((row) => (
              <AgentMeters key={row.id} row={row} name={names.get(row.id) ?? '에이전트'} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
