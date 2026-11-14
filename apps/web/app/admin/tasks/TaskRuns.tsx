import { when } from '../../_task/labels';
import type { TaskRun } from '../../_task/types';

/**
 * 작업의 실행 기록: 빌려 줄 때마다 한 줄. 어떤 규칙(에이전트 설정 · 스킬 · 지시문 틀의 버전, 러너 빌드 · CLI · 모델)으로 돌았는지.
 * 결과가 바뀐 까닭을 버전과 해시로 비교한다 (지시문 글은 남기지 않는다)
 */
export function TaskRuns({ runs }: { runs: readonly TaskRun[] }) {
  if (runs.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="task-runs">
      <h2 id="task-runs">실행 기록</h2>
      <ol className="list" aria-label="실행">
        {runs.map((r) => (
          <li key={r.seq} className="list-cell stack">
            <div>
              <b>{r.seq}회</b> <span className="label-mono">{when(r.startedAt)}</span>
            </div>
            <dl className="kv">
              {r.agentRevision !== null && (
                <>
                  <dt>에이전트 설정</dt>
                  <dd>버전 {r.agentRevision}</dd>
                </>
              )}
              <dt>스킬</dt>
              <dd>
                {r.skill === null
                  ? '없음'
                  : `${r.skill.name} · ${r.skill.source === 'console' ? `콘솔 버전 ${r.skill.revision}` : '저장소 버전'} · ${(r.skill.hash ?? '').slice(0, 7)}`}
              </dd>
              {r.prompt !== null && (
                <>
                  <dt>지시문 틀</dt>
                  <dd>
                    {`${r.prompt.source === 'console' ? `콘솔 버전 ${r.prompt.revision}` : '저장소 버전'} · ${(r.prompt.hash ?? '').slice(0, 7)}`}
                  </dd>
                </>
              )}
              <dt>러너 빌드</dt>
              <dd>{r.runnerBuild ?? '알 수 없음'}</dd>
              <dt>CLI</dt>
              <dd>{r.cliVersion ?? '알 수 없음'}</dd>
              <dt>모델</dt>
              <dd>{r.model ?? '보고 전'}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 맨 아래를 보고 있으면 새 줄을 따라가고, 위로 올려 읽는 중이면 그대로 둔다 */
