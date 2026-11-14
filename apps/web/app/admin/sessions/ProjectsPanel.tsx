'use client';

import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import type { ProjectRules } from '../../_vault/types';

/** 세션이 들어오면 프로젝트 목록도 다시 읽는다 */
const TOPICS = ['vault.session.*'];

// 프로젝트별 원문 모으기 (2차 4단계): 수집 훅 · 확장이 올린 원문을 프로젝트마다 받을지. 끄면 다음 원문부터 쌓지 않는다.
// 저장소의 .cairn.json에 "collect": false가 있으면 내 컴퓨터에서부터 올리지 않는다 (이 화면과 따로)
export function ProjectsPanel() {
  const rules = useLiveValue(
    'project-rules',
    () => api<ProjectRules>('GET', '/api/project-rules'),
    TOPICS,
  );
  const action = useAction();
  const projects = rules.data?.projects ?? [];
  const problem = action.problem ?? rules.error;
  if (projects.length === 0 && !problem) return null;

  function toggle(project: string, collect: boolean) {
    void action.run(
      `collect:${project}`,
      () => api('PUT', '/api/project-rules', { project, collect: !collect }),
      { reload: rules.reload },
    );
  }

  return (
    <section className="plugin" aria-label="프로젝트별 모으기">
      <div className="plugin-head">
        <div>
          <b>프로젝트별 모으기</b>
          <p>끄면 그 프로젝트의 세션 원문을 받지 않음</p>
        </div>
      </div>
      <ul className="list">
        {projects.map((p) => (
          <li key={p.project} className="list-cell row" style={{ justifyContent: 'space-between' }}>
            <span>
              <b>{p.project}</b>
              <small className="note"> · 세션 {p.sessions}개</small>
            </span>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={p.collect}
              aria-label={`${p.project} 모으기`}
              disabled={action.busy !== null}
              onClick={() => toggle(p.project, p.collect)}
            />
          </li>
        ))}
      </ul>
      {problem && <p className="error">{problem}</p>}
    </section>
  );
}
