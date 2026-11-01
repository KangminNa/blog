import type { Graph, GraphNode } from './types';

// 그래프 화면의 물리와 그리기. 승인한 시안의 힘 시뮬레이션을 Canvas로 옮겼다 (라이브러리 없음).
// 점과 선이 힘으로 자리를 잡고, 끌면 이웃이 따라오고, 고르면 이웃만 남는다 (MVP 기획서 7.5).
// 화면(React)은 데이터와 조작만 넘기고, 고른 점은 onSelect로 받는다. 색은 globals.css의 토큰만 읽는다.

type Point = {
  id: string;
  kind: string;
  label: string;
  /** 비공개 자리: 이름 없이 테두리만 */
  hidden: boolean;
  i: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 처음 자리 (화면 맞추기, 자라나는 첫 장면) */
  fx: number;
  fy: number;
  /** 점 불투명도, 이름 불투명도, 크기 배율 */
  o: number;
  l: number;
  s: number;
  deg: number;
  /** 잡고 있는 점은 힘을 받지 않는다 */
  fixed: boolean;
  /** 재생할 때 아직 나오지 않은 점은 false */
  alive: boolean;
  /** 이름 폭. 그때마다 재면 점이 많을 때 느리다 */
  width: number;
};

type Line = { a: Point; b: Point; main: boolean; dash: readonly number[] };

/** 설정 패널의 값 */
export type SceneParams = {
  size: number;
  line: number;
  repel: number;
  dist: number;
  labels: boolean;
  motion: boolean;
};

type Colors = { bg: string; fg: string; muted: string; faint: string; font: string };

const SOLID: readonly number[] = [];
/** 주소 밖 선은 종류별 모양으로 구분한다 */
const DASHES: Readonly<Record<string, readonly number[]>> = {
  material: [3, 4],
  link: [1, 3],
  ref: [6, 3],
};
const LABEL_ORDER: Readonly<Record<string, number>> = { category: 1, post: 2, wiki: 3, session: 4 };
const UNTITLED = '제목 없음';
/** 처음 자리를 잡는 데 쓰는 시간. 넘으면 남은 일은 화면에서 움직이며 마친다 */
const SETTLE_MS = 250;
const SETTLE_STEPS = 420;
/** 점이 이만큼 늘어날 때마다 물리를 한 프레임씩 건너뛴다 (500개까지는 매 프레임) */
const STRIDE_NODES = 800;
const REPEL_RANGE = 90_000;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 5;
const EASE = 0.14;
/** 처음 자라나는 동안 화면을 맞추는 간격과 끝 (프레임) */
const FOLLOW_EVERY = 20;
const FOLLOW_FRAMES = 300;

const ease = (value: number, to: number, by: number) => value + (to - value) * by;

export class GraphScene {
  readonly params: SceneParams;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly events = new AbortController();
  private readonly observer: ResizeObserver;
  private readonly theme: MutationObserver;
  private points: Point[] = [];
  private byId = new Map<string, Point>();
  private lines: Line[] = [];
  private neighbors = new Map<Point, Set<Point>>();
  private layers: Record<string, boolean> = { session: true, wiki: true, post: true };
  private readonly cam = { x: 0, y: 0, k: 1 };
  private readonly goal = { x: 0, y: 0, k: 1 };
  private colors: Colors = { bg: '', fg: '', muted: '', faint: '', font: '' };
  private W = 0;
  private H = 0;
  private selected: Point | null = null;
  private hover: Point | null = null;
  private focus: Point | null = null;
  private focusNear: Set<Point> | null = null;
  private find = '';
  private drag: Point | null = null;
  private pan: [number, number] | null = null;
  private moved = false;
  private pinch = 0;
  private readonly pointers = new Map<number, [number, number]>();
  private alpha: number;
  /** 재생 중 다음에 나올 점의 번호 */
  private reveal: number | null = null;
  private frameNo = 0;
  private raf = 0;
  private fading = false;
  private seeded = false;
  /** 자라나는 동안은 화면을 따라 맞춘다. 사람이 움직이면 그만둔다 */
  private following = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelect: (id: string | null) => void,
    private readonly onReplayEnd: () => void,
    private readonly reduced: boolean,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas를 쓸 수 없어요');
    this.ctx = ctx;
    this.params = { size: 1, line: 1, repel: 1300, dist: 1, labels: true, motion: !reduced };
    this.alpha = reduced ? 0.05 : 0.9;
    this.readColors();
    this.listen();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.theme = new MutationObserver(() => this.repaint());
    this.theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    this.resize();
  }

  destroy(): void {
    this.events.abort();
    this.observer.disconnect();
    this.theme.disconnect();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** 데이터를 넣는다. 다시 읽어도 이미 있는 점은 자리를 지키고, 새 점은 부모 옆에서 나온다 */
  load(graph: Graph): void {
    const known = new Map(this.points.map((p) => [p.id, p]));
    const first = this.points.length === 0;
    this.points = graph.nodes.map((node, i) => {
      const found = known.get(node.id);
      return found ? GraphScene.refresh(found, node, i) : GraphScene.point(node, i);
    });
    this.byId = new Map(this.points.map((p) => [p.id, p]));
    this.link(graph);
    for (const node of graph.nodes) {
      const parent = node.parent ? this.byId.get(node.parent) : null;
      const p = this.byId.get(node.id);
      if (!parent || !p || known.has(node.id)) continue;
      p.x = parent.x + Math.cos(p.i) * 6;
      p.y = parent.y + Math.sin(p.i) * 6;
    }
    if (this.selected && !this.byId.has(this.selected.id)) this.select(null);
    if (this.hover && !this.byId.has(this.hover.id)) this.hover = null;
    if (first) this.seed();
    this.alpha = Math.max(this.alpha, this.reduced ? 0.05 : 0.3);
    this.wake();
  }

  setFind(text: string): void {
    this.find = text.trim().toLowerCase();
    this.wake();
  }

  setLayer(kind: string, on: boolean): void {
    this.layers[kind] = on;
    this.alpha = Math.max(this.alpha, 0.3);
    this.wake();
  }

  /** 설정 패널의 값을 바꾼 뒤에 부른다. 힘이 바뀌었으니 다시 움직인다 */
  nudge(): void {
    this.alpha = Math.max(this.alpha, 0.6);
    this.wake();
  }

  /** 점 하나를 고른다. glide면 카메라가 그 점으로 간다 */
  select(id: string | null, glide = false): void {
    const point = id ? (this.byId.get(id) ?? null) : null;
    this.selected = point;
    if (point && glide) {
      this.following = false;
      this.goal.x = this.W / 2 - point.x * this.goal.k;
      this.goal.y = this.H / 2 - point.y * this.goal.k;
    }
    this.onSelect(point?.id ?? null);
    this.wake();
  }

  /** 화면에 다 들어오게 한다 */
  fit(snap = false): void {
    if (!this.W || this.points.length === 0) return;
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of this.points) {
      const [x, y] = snap ? [p.fx, p.fy] : [p.x, p.y];
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const k = Math.min((this.W - 60) / (x1 - x0 || 1), (this.H - 120) / (y1 - y0 || 1), 1.5) * 0.86;
    this.goal.k = k;
    this.goal.x = this.W / 2 - ((x0 + x1) / 2) * k;
    this.goal.y = this.H / 2 + 14 - ((y0 + y1) / 2) * k;
    if (snap) Object.assign(this.cam, this.goal);
    this.wake();
  }

  /** 점이 하나씩 나오는 장면. 돌고 있으면 멈추고 다 보인다. 돌기 시작했으면 true */
  replay(): boolean {
    if (this.reveal !== null) {
      this.finishReplay();
      return false;
    }
    for (const p of this.points) p.alive = false;
    this.reveal = 0;
    this.select(null);
    return true;
  }

  private finishReplay(): void {
    this.reveal = null;
    for (const p of this.points) p.alive = true;
    this.wake();
  }

  private static point(node: GraphNode, i: number): Point {
    const x = Math.cos(i * 2.4) * (40 + i * 4);
    const y = Math.sin(i * 2.4) * (40 + i * 4);
    return {
      ...GraphScene.text(node),
      i,
      x,
      y,
      vx: 0,
      vy: 0,
      fx: x,
      fy: y,
      o: 1,
      l: 0,
      s: 1,
      deg: 0,
      fixed: false,
      alive: true,
      width: -1,
    };
  }

  private static refresh(point: Point, node: GraphNode, i: number): Point {
    Object.assign(point, GraphScene.text(node), { i, width: -1 });
    return point;
  }

  private static text(node: GraphNode) {
    const hidden = node.kind === 'wiki' && node.label === '' && node.visibility === 'private';
    return {
      id: node.id,
      kind: node.kind,
      label: node.label || UNTITLED,
      hidden,
    };
  }

  private link(graph: Graph): void {
    const lines: Line[] = [];
    for (const node of graph.nodes) {
      const a = node.parent ? this.byId.get(node.parent) : null;
      const b = this.byId.get(node.id);
      if (a && b) lines.push({ a, b, main: true, dash: SOLID });
    }
    for (const edge of graph.edges) {
      const a = this.byId.get(edge.src);
      const b = this.byId.get(edge.dst);
      if (a && b) lines.push({ a, b, main: false, dash: DASHES[edge.kind] ?? SOLID });
    }
    this.lines = lines;
    this.neighbors = new Map(this.points.map((p) => [p, new Set<Point>()]));
    for (const { a, b } of lines) {
      this.neighbors.get(a)?.add(b);
      this.neighbors.get(b)?.add(a);
    }
    for (const p of this.points) p.deg = this.neighbors.get(p)?.size ?? 0;
  }

  /** 처음 한 번 자리를 잡고, 움직여도 되면 가운데에서 자라나게 둔다 */
  private seed(): void {
    let alpha = 1;
    const end = performance.now() + SETTLE_MS;
    for (let t = 0; t < SETTLE_STEPS && performance.now() < end; t++) {
      this.step(alpha, 0);
      alpha *= 0.99;
    }
    for (const p of this.points) {
      p.fx = p.x;
      p.fy = p.y;
      p.vx = 0;
      p.vy = 0;
    }
    this.seeded = true;
    this.fit(true);
    if (this.reduced) return;
    for (const p of this.points) {
      p.x = p.fx * 0.18 + ((p.i % 7) - 3);
      p.y = p.fy * 0.18 + ((p.i % 5) - 2);
    }
  }

  private step(alpha: number, now: number): void {
    const { repel, dist, motion } = this.params;
    const list = this.points;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Point;
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Point;
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = dx * dx + dy * dy || 1;
        if (d > REPEL_RANGE) continue;
        const f = (repel * alpha) / d;
        a.vx -= dx * f;
        a.vy -= dy * f;
        b.vx += dx * f;
        b.vy += dy * f;
      }
    }
    for (const { a, b, main } of this.lines) {
      if (!a.alive || !b.alive) continue;
      const want = (a.kind === 'category' ? 58 : 30) * dist * (main ? 1 : 2.4);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = ((d - want) / d) * (main ? 0.1 : 0.012) * alpha;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const p of list) {
      if (!p.alive) continue;
      p.vx -= p.x * 0.004 * alpha;
      p.vy -= p.y * 0.004 * alpha;
      if (motion && now) {
        p.vx += Math.cos(now / 2600 + p.i * 1.7) * 0.012;
        p.vy += Math.sin(now / 3100 + p.i * 2.3) * 0.012;
      }
      if (p.fixed) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.vx *= 0.78;
      p.vy *= 0.78;
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (!this.W) return;
    this.frameNo += 1;
    if (this.reveal !== null) this.showNext();
    const { motion } = this.params;
    if (this.frameNo % Math.ceil(this.points.length / STRIDE_NODES || 1) === 0)
      this.step(this.alpha, motion ? now : 0);
    this.alpha = ease(this.alpha, this.drag ? 0.5 : motion ? 0.06 : 0.001, 0.025);
    if (this.following && this.frameNo % FOLLOW_EVERY === 0) {
      if (this.frameNo > FOLLOW_FRAMES) this.following = false;
      else this.fit();
    }
    this.cam.x = ease(this.cam.x, this.goal.x, 0.16);
    this.cam.y = ease(this.cam.y, this.goal.y, 0.16);
    this.cam.k = ease(this.cam.k, this.goal.k, 0.16);
    this.draw();
    if (this.moving) this.wake();
  };

  /** 다음 프레임이 필요한가. 움직임을 껐으면 다 멈춘 뒤에는 그리지 않는다 */
  private get moving(): boolean {
    const camera =
      Math.abs(this.cam.x - this.goal.x) > 0.1 ||
      Math.abs(this.cam.y - this.goal.y) > 0.1 ||
      Math.abs(this.cam.k - this.goal.k) > 0.001;
    return (
      this.params.motion ||
      this.alpha > 0.004 ||
      this.fading ||
      camera ||
      this.drag !== null ||
      this.reveal !== null
    );
  }

  private wake(): void {
    if (this.raf || !this.W || document.hidden) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private showNext(): void {
    this.alpha = Math.max(this.alpha, 0.55);
    if (this.frameNo % 2 !== 0) return;
    const p = this.points[this.reveal ?? 0];
    if (!p) {
      this.finishReplay();
      this.onReplayEnd();
      return;
    }
    p.alive = true;
    p.s = 0;
    const parent = [...(this.neighbors.get(p) ?? [])].find((n) => n.alive && n !== p);
    if (parent) {
      p.x = parent.x + Math.cos(p.i) * 6;
      p.y = parent.y + Math.sin(p.i) * 6;
      p.vx = 0;
      p.vy = 0;
    }
    this.reveal = (this.reveal ?? 0) + 1;
  }

  private shown(p: Point): boolean {
    return p.alive && (p.kind === 'category' || this.layers[p.kind] !== false);
  }

  private hits(p: Point): boolean {
    return !p.hidden && this.find !== '' && p.label.toLowerCase().includes(this.find);
  }

  private radius(p: Point): number {
    const base =
      p.kind === 'category' ? 7 : p.kind === 'post' ? 4.6 : 2.2 + Math.sqrt(p.deg) * 1.15;
    return base * this.params.size;
  }

  private screen(p: Point): readonly [number, number] {
    return [p.x * this.cam.k + this.cam.x, p.y * this.cam.k + this.cam.y];
  }

  private draw(): void {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    const focus = this.hover ?? this.selected;
    if (focus !== this.focus) {
      this.focus = focus;
      this.focusNear = focus ? new Set([focus, ...(this.neighbors.get(focus) ?? [])]) : null;
    }
    this.fade();
    this.drawLines();
    this.drawPoints();
    this.drawLabels();
    ctx.globalAlpha = 1;
  }

  /** 고른 점과 이웃만 밝게. 흐려지고 커지는 값을 조금씩 따라간다 */
  private fade(): void {
    const { k } = this.cam;
    const near = this.focusNear;
    this.fading = false;
    for (const p of this.points) {
      const dim = (near !== null && !near.has(p)) || (this.find !== '' && !this.hits(p));
      const wants =
        this.params.labels &&
        !p.hidden &&
        !dim &&
        (near?.has(p) ||
          this.hits(p) ||
          p.kind === 'category' ||
          (p.kind === 'post' && k > 0.7) ||
          (p.kind === 'wiki' && k > 1) ||
          k > 2.1);
      const [o, l] = [dim ? 0.1 : 1, wants ? 1 : 0];
      if (Math.abs(p.o - o) > 0.01 || Math.abs(p.l - l) > 0.01 || Math.abs(p.s - 1) > 0.01)
        this.fading = true;
      p.o = ease(p.o, o, EASE);
      p.l = ease(p.l, l, EASE);
      p.s = ease(p.s, 1, EASE);
    }
  }

  private drawLines(): void {
    const { ctx, focus } = this;
    ctx.strokeStyle = this.colors.fg;
    for (const { a, b, main, dash } of this.lines) {
      if (!this.shown(a) || !this.shown(b)) continue;
      const on = focus !== null && (a === focus || b === focus);
      const quiet = focus !== null || this.find !== '';
      ctx.globalAlpha = (on ? 0.85 : quiet ? 0.04 : main ? 0.2 : 0.08) * Math.min(a.s, b.s);
      ctx.lineWidth = (on ? 1.4 : 0.9) * this.params.line;
      ctx.setLineDash(dash as number[]);
      const [ax, ay] = this.screen(a);
      const [bx, by] = this.screen(b);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawPoints(): void {
    const { ctx, focus, colors } = this;
    const zoom = Math.min(1.3, Math.max(0.75, Math.sqrt(this.cam.k)));
    for (const p of this.points) {
      if (!this.shown(p)) continue;
      const r = this.radius(p) * zoom * p.s;
      const [x, y] = this.screen(p);
      ctx.globalAlpha = p.o;
      this.shape(p.kind, x, y, r);
      if (p.hidden) {
        ctx.strokeStyle = colors.faint;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (p.kind === 'post') {
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.strokeStyle = colors.fg;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle =
          p.kind === 'session' ? colors.faint : p.kind === 'wiki' ? colors.muted : colors.fg;
        ctx.fill();
      }
      if (p === focus) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = colors.fg;
        this.shape(p.kind, x, y, r + 4);
        ctx.stroke();
      }
    }
  }

  /** 종류는 색이 아니라 모양과 크기로 구분한다: 카테고리는 마름모, 글은 네모, wiki·세션은 원 */
  private shape(kind: string, x: number, y: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    if (kind === 'category') {
      const d = r * 1.3;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
    } else if (kind === 'post') {
      ctx.rect(x - r, y - r, r * 2, r * 2);
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  private drawLabels(): void {
    const { ctx, focus, colors, W, H } = this;
    const list = this.points
      .filter((p) => this.shown(p) && p.l > 0.03)
      .sort(
        (a, b) =>
          Number(b === focus) - Number(a === focus) ||
          (LABEL_ORDER[a.kind] ?? 9) - (LABEL_ORDER[b.kind] ?? 9),
      );
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const taken: [number, number, number, number][] = [];
    for (const p of list) {
      const px = p.kind === 'category' ? 13 : 12;
      ctx.font = `${p.kind === 'category' ? 600 : 400} ${px}px ${colors.font}`;
      if (p.width < 0) p.width = ctx.measureText(p.label).width;
      const [sx, sy] = this.screen(p);
      const x = sx - p.width / 2;
      const y = sy + this.radius(p) + 6;
      const right = x + p.width;
      const bottom = y + px + 3;
      if (right < 0 || x > W || y > H || y < 0) continue;
      if (taken.some((t) => x < t[2] && right > t[0] && y < t[3] && bottom > t[1])) continue;
      taken.push([x - 3, y - 1, right + 3, bottom]);
      ctx.globalAlpha = p.l;
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.bg;
      ctx.strokeText(p.label, sx, y);
      ctx.fillStyle = p === focus || p.kind === 'category' ? colors.fg : colors.muted;
      ctx.fillText(p.label, sx, y);
    }
  }

  private readColors(): void {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
    this.colors = {
      bg: token('bg'),
      fg: token('fg'),
      muted: token('muted'),
      faint: token('faint'),
      font: token('ui'),
    };
  }

  private repaint(): void {
    this.readColors();
    for (const p of this.points) p.width = -1;
    this.draw();
  }

  private resize(): void {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width) return;
    const opening = !this.W;
    this.W = box.width;
    this.H = box.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (opening && this.seeded) this.fit(true);
    if (this.seeded) this.draw();
    this.wake();
  }

  private at(e: PointerEvent | WheelEvent): [number, number] {
    const box = this.canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  }

  private hit(mx: number, my: number): Point | null {
    let best: Point | null = null;
    let nearest = 18;
    const { k } = this.cam;
    for (const p of this.points) {
      if (!this.shown(p)) continue;
      const [x, y] = this.screen(p);
      const d = Math.hypot(x - mx, y - my);
      if (d < Math.max(this.radius(p) * k, 7) + 6 && d < nearest) {
        nearest = d;
        best = p;
      }
    }
    return best;
  }

  private zoomAt(mx: number, my: number, factor: number): void {
    const { goal } = this;
    this.following = false;
    const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, goal.k * factor));
    goal.x = mx - ((mx - goal.x) * k) / goal.k;
    goal.y = my - ((my - goal.y) * k) / goal.k;
    goal.k = k;
    this.wake();
  }

  private release(): void {
    if (this.drag) {
      this.drag.fixed = false;
      this.alpha = Math.max(this.alpha, 0.4);
    }
    this.drag = null;
    this.pan = null;
    this.pinch = 0;
    this.canvas.classList.remove('drag');
    this.wake();
  }

  private listen(): void {
    const { canvas } = this;
    const on = { signal: this.events.signal };
    canvas.addEventListener('pointerdown', (e) => this.down(e), on);
    canvas.addEventListener('pointermove', (e) => this.over(e), on);
    canvas.addEventListener('pointerup', (e) => this.up(e), on);
    canvas.addEventListener(
      'pointercancel',
      () => {
        this.pointers.clear();
        this.release();
      },
      on,
    );
    canvas.addEventListener(
      'pointerleave',
      () => {
        this.hover = null;
        this.wake();
      },
      on,
    );
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [mx, my] = this.at(e);
        this.zoomAt(mx, my, Math.exp(-e.deltaY * 0.0018));
      },
      { ...on, passive: false },
    );
    // 탭을 가리면 멈추고, 돌아오면 다시 돈다
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          cancelAnimationFrame(this.raf);
          this.raf = 0;
        } else {
          this.wake();
        }
      },
      on,
    );
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.repaint(), on);
  }

  private down(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const [mx, my] = this.at(e);
    this.pointers.set(e.pointerId, [mx, my]);
    this.moved = false;
    this.following = false;
    if (this.pointers.size !== 1) {
      this.release();
      return;
    }
    const p = this.hit(mx, my);
    if (p) {
      this.drag = p;
      p.fixed = true;
      this.alpha = Math.max(this.alpha, 0.5);
    } else {
      this.pan = [mx - this.goal.x, my - this.goal.y];
    }
    this.canvas.classList.add('drag');
    this.wake();
  }

  private over(e: PointerEvent): void {
    const [mx, my] = this.at(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [mx, my]);
    if (this.pointers.size === 2) {
      this.pinchTo();
      return;
    }
    if (this.drag) {
      this.moved = true;
      this.drag.x = (mx - this.cam.x) / this.cam.k;
      this.drag.y = (my - this.cam.y) / this.cam.k;
    } else if (this.pan) {
      this.moved = true;
      this.goal.x = this.cam.x = mx - this.pan[0];
      this.goal.y = this.cam.y = my - this.pan[1];
    } else {
      const p = this.hit(mx, my);
      if (p !== this.hover) {
        this.hover = p;
        this.canvas.classList.toggle('over', p !== null);
      }
    }
    this.wake();
  }

  private pinchTo(): void {
    const [a, b] = [...this.pointers.values()] as [[number, number], [number, number]];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (this.pinch) this.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / this.pinch);
    this.pinch = d;
    this.moved = true;
  }

  private up(e: PointerEvent): void {
    const [mx, my] = this.at(e);
    this.pointers.delete(e.pointerId);
    if (!this.moved && this.pointers.size === 0) {
      const p = this.hit(mx, my);
      this.select(p?.id ?? null);
    }
    this.release();
  }
}
