'use client';

import './vault.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { postPath } from '../_blog/format';
import { GraphScene, type SceneParams } from './graph-scene';
import type { Graph, GraphNode } from './types';

const KIND_LABELS: Readonly<Record<string, string>> = {
  category: '카테고리',
  wiki: '위키',
  session: '세션',
  post: '글',
};
const LAYERS: readonly (readonly [string, string])[] = [
  ['post', '글'],
  ['wiki', '위키'],
  ['session', '세션'],
];
const LIST_ORDER: readonly string[] = ['category', 'post', 'wiki', 'session'];
const UNTITLED = '제목 없음';
/** 고른 점의 칸에 보여 주는 이웃 수 */
const NEAR_SHOWN = 6;
const DEFAULT_PARAMS: SceneParams = {
  size: 1,
  line: 1,
  repel: 1300,
  dist: 1,
  labels: true,
  motion: true,
};
const SLIDERS: readonly (readonly [keyof SceneParams, string, number, number, number])[] = [
  ['size', '노드 크기', 0.6, 1.8, 0.1],
  ['line', '선 굵기', 0.4, 2.4, 0.1],
  ['repel', '밀어내는 힘', 400, 3200, 100],
  ['dist', '연결 거리', 0.5, 2, 0.1],
];

/** 비공개 자리: 서버가 이름과 주소를 비워 보낸 wiki */
const isPlace = (n: GraphNode) => n.kind === 'wiki' && n.label === '' && n.visibility === 'private';

const nameOf = (n: GraphNode) =>
  isPlace(n) ? `비공개 ${KIND_LABELS[n.kind]}` : n.label || UNTITLED;

/** 이어진 점들: 주소와 선 모두 */
function neighborsOf(graph: Graph, id: string): readonly GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(id);
  const ids = new Set<string>();
  if (node?.parent) ids.add(node.parent);
  for (const n of graph.nodes) if (n.parent === id) ids.add(n.id);
  for (const e of graph.edges) {
    if (e.src === id) ids.add(e.dst);
    if (e.dst === id) ids.add(e.src);
  }
  return [...ids].flatMap((i) => byId.get(i) ?? []);
}

/** 고른 점을 여는 주소. 방문자는 공개 글만 열 수 있다 */
function linkOf(n: GraphNode, admin: boolean): readonly [string, string] | null {
  if (n.kind === 'post' && admin) return [`/admin/posts/${n.id}`, '글 열기'];
  if (n.kind === 'post' && n.slug) return [postPath(n.slug), '글 읽기'];
  if (n.kind === 'wiki' && admin) return [`/admin/wiki?wiki=${n.id}`, '위키 열기'];
  if (n.kind === 'session' && admin) return [`/admin/sessions?session=${n.id}`, '세션 열기'];
  return null;
}

// 그래프 화면: Canvas 물리 그래프 + 찾기, 층 끄기, 설정, 고른 점의 칸. 키보드와 화면 낭독기는 목록으로 같은 내용을 본다.
export function GraphBoard({ graph, admin }: { graph: Graph; admin: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<GraphScene | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [find, setFind] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [panel, setPanel] = useState(false);
  const [params, setParams] = useState<SceneParams>(DEFAULT_PARAMS);
  const [playing, setPlaying] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const made = new GraphScene(canvas.current, setSelected, () => setPlaying(false), reduced);
    scene.current = made;
    setStill(reduced);
    setParams(made.params);
    return () => {
      made.destroy();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.load(graph);
  }, [graph]);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const picked = selected ? (byId.get(selected) ?? null) : null;

  function change<K extends keyof SceneParams>(key: K, value: SceneParams[K]) {
    if (!scene.current) return;
    scene.current.params[key] = value;
    scene.current.nudge();
    setParams({ ...scene.current.params });
  }

  function toggleLayer(kind: string) {
    const next = new Set(hidden);
    if (!next.delete(kind)) next.add(kind);
    setHidden(next);
    scene.current?.setLayer(kind, !next.has(kind));
  }

  return (
    <div className="g-host">
      <canvas
        ref={canvas}
        role="img"
        aria-label="세션과 위키, 글이 이어진 그래프. 같은 내용은 목록 버튼으로 볼 수 있어요"
      />
      <div className="g-tools">
        <label className="sr" htmlFor="graph-find">
          그래프 찾기
        </label>
        <input
          id="graph-find"
          className="g-search"
          type="search"
          placeholder="찾기"
          value={find}
          onChange={(e) => {
            setFind(e.target.value);
            scene.current?.setFind(e.target.value);
          }}
        />
        {LAYERS.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className="ghost"
            aria-pressed={!hidden.has(kind)}
            onClick={() => toggleLayer(kind)}
          >
            {label}
          </button>
        ))}
        <span className="spacer" />
        <button
          type="button"
          className="ghost"
          aria-pressed={showList}
          onClick={() => setShowList(!showList)}
        >
          목록
        </button>
        {!still && (
          <button
            type="button"
            className="ghost"
            onClick={() => setPlaying(scene.current?.replay() ?? false)}
          >
            {playing ? '중지' : '재생'}
          </button>
        )}
        <button type="button" className="ghost" onClick={() => scene.current?.fit()}>
          전체 보기
        </button>
        <button
          type="button"
          className="ghost"
          aria-expanded={panel}
          onClick={() => setPanel(!panel)}
        >
          설정
        </button>
      </div>
      {panel && (
        <div className="g-panel">
          {SLIDERS.map(([key, label, min, max, step]) => (
            <label key={key}>
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={Number(params[key])}
                onChange={(e) => change(key, Number(e.target.value))}
              />
            </label>
          ))}
          <SwitchRow label="이름 표시" on={params.labels} flip={(v) => change('labels', v)} />
          <SwitchRow label="움직임" on={params.motion} flip={(v) => change('motion', v)} />
        </div>
      )}
      {showList && (
        <NodeList
          graph={graph}
          find={find}
          hidden={hidden}
          pick={(id) => scene.current?.select(id, true)}
        />
      )}
      {picked && (
        <Inspector
          node={picked}
          near={neighborsOf(graph, picked.id)}
          admin={admin}
          pick={(id) => scene.current?.select(id, true)}
          close={() => scene.current?.select(null)}
        />
      )}
      <div className="g-legend" aria-hidden="true">
        <span>
          <i className="g-mark category" />
          카테고리
        </span>
        <span>
          <i className="g-mark post" />글
        </span>
        <span>
          <i className="g-mark wiki" />
          위키
        </span>
        <span>
          <i className="g-mark session" />
          세션
        </span>
        {!admin && (
          <span>
            <i className="g-mark place" />
            비공개
          </span>
        )}
      </div>
      {graph.nodes.length === 0 && <p className="g-empty">아직 보여 줄 내용 없음</p>}
    </div>
  );
}

function SwitchRow({
  label,
  on,
  flip,
}: {
  label: string;
  on: boolean;
  flip: (value: boolean) => void;
}) {
  return (
    <div className="g-row">
      <span>{label}</span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => flip(!on)}
      />
    </div>
  );
}

function Inspector({
  node,
  near,
  admin,
  pick,
  close,
}: {
  node: GraphNode;
  near: readonly GraphNode[];
  admin: boolean;
  pick: (id: string) => void;
  close: () => void;
}) {
  const place = isPlace(node);
  const open = near.filter((n) => !isPlace(n));
  const secret = near.length - open.length;
  const link = linkOf(node, admin);
  return (
    <aside className="inspector" aria-label="선택한 노드" aria-live="polite">
      <div className="g-row">
        <span className="kind">
          {place ? '비공개' : KIND_LABELS[node.kind]}
          {admin && node.visibility === 'private' ? ' · 비공개' : ''}
        </span>
        <button type="button" className="g-close" aria-label="닫기" onClick={close}>
          ×
        </button>
      </div>
      <h2>{nameOf(node)}</h2>
      {!place && (
        <p className="note">
          연결 {near.length}개{secret > 0 ? ` (비공개 ${secret}개)` : ''}
        </p>
      )}
      {!place && open.length > 0 && (
        <div className="linked">
          {open.slice(0, NEAR_SHOWN).map((n) => (
            <button key={n.id} type="button" onClick={() => pick(n.id)}>
              {nameOf(n)}
            </button>
          ))}
        </div>
      )}
      {link && (
        <a className="cta small" href={link[0]}>
          {link[1]}
        </a>
      )}
    </aside>
  );
}

/** Canvas를 쓰지 못하는 사람을 위한 같은 내용의 목록. 찾기와 층 끄기가 그대로 먹는다 */
function NodeList({
  graph,
  find,
  hidden,
  pick,
}: {
  graph: Graph;
  find: string;
  hidden: ReadonlySet<string>;
  pick: (id: string) => void;
}) {
  const word = find.trim().toLowerCase();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const shown = graph.nodes.filter(
    (n) => !hidden.has(n.kind) && (!word || nameOf(n).toLowerCase().includes(word)),
  );
  return (
    <section className="g-list" aria-label="그래프 목록">
      {LIST_ORDER.map((kind) => {
        const rows = shown.filter((n) => n.kind === kind);
        if (rows.length === 0) return null;
        return (
          <div key={kind}>
            <h2>
              {KIND_LABELS[kind]} {rows.length}
            </h2>
            <ul>
              {rows.map((n) => {
                const parent = n.parent ? byId.get(n.parent) : null;
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => pick(n.id)}>
                      <span>{nameOf(n)}</span>
                      {parent && <small>{nameOf(parent)}</small>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {shown.length === 0 && <p className="rows-empty">찾은 내용 없음</p>}
    </section>
  );
}
