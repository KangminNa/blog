'use client';

import { GraphBoard } from '../../_vault/GraphBoard';
import { useGraph } from '../../_vault/live';

// 주인의 그래프. 신호가 오면 다시 읽고, 이미 있는 점은 자리를 지킨다.
export function GraphPanel() {
  const graph = useGraph();
  if (!graph.data)
    return (
      <section className="console-inner" aria-label="그래프">
        {graph.error ? (
          <p className="error">{graph.error}</p>
        ) : (
          <p className="label-mono">불러오는 중…</p>
        )}
      </section>
    );
  return <GraphBoard graph={graph.data} admin />;
}
