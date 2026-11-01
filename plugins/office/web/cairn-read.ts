import type { FeedAgent, FeedSnapshot, FeedTask } from './cairn-feed';

// 서버 읽기와 변경 신호. 플러그인 화면은 코어 파일을 가져오지 못하므로(plugins/CLAUDE.md)
// 콘솔의 다른 화면처럼 /api와 /api/stream을 브라우저 기능(fetch, EventSource)으로 바로 부른다.

/** 다시 읽게 하는 신호. `.*`는 그 앞이 같은 주제 모두 (API설계 6장) */
const TOPICS = [
  'task.task.changed',
  'task.event.added',
  'task.agent.changed',
  'task.approval.*',
  'task.usage.changed',
];
/** 신호가 몰릴 때 다시 읽는 간격 */
const REREAD_MS = 500;
/** 서버가 오류로 답해 브라우저가 다시 잇기를 포기했을 때 다시 여는 간격 */
const REOPEN_MS = 3000;
/** 쉬는 창이 끝나는 일에는 신호가 없다. 쉬던 에이전트가 돌아온 것이 보이게 이 간격으로도 읽는다 */
const HOLD_REREAD_MS = 60_000;

function matches(topic: string): boolean {
  return TOPICS.some((p) => (p.endsWith('.*') ? topic.startsWith(p.slice(0, -1)) : p === topic));
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path).catch(() => null);
  if (!res) throw new Error('서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요');
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `오류 ${res.status}`);
  return body;
}

type TaskList = { tasks: FeedTask[] };

/** 읽은 값 하나를 만든다. 실행 기록은 작업의 마지막 기록이 바뀐 때만 다시 읽는다 */
export class CairnReader {
  private readonly seen = new Map<string, { last: string | null; kinds: readonly string[] }>();

  async read(): Promise<FeedSnapshot> {
    const [agents, running, waiting, usage] = await Promise.all([
      get<{ agents: FeedAgent[] }>('/api/agents'),
      get<TaskList>('/api/tasks?status=running'),
      get<TaskList>('/api/tasks?status=waiting'),
      get<{ agents: { id: string; holding: boolean }[] }>('/api/usage'),
    ]);
    const kinds = await Promise.all(running.tasks.map((task) => this.kindsOf(task)));
    this.forgetExcept(running.tasks);
    return {
      agents: agents.agents,
      running: running.tasks,
      waiting: waiting.tasks,
      held: usage.agents.filter((a) => a.holding).map((a) => a.id),
      events: Object.fromEntries(running.tasks.map((task, i) => [task.id, kinds[i] ?? []])),
    };
  }

  private async kindsOf(task: FeedTask): Promise<readonly string[]> {
    const known = this.seen.get(task.id);
    if (known && known.last === task.lastEvent) return known.kinds;
    const detail = await get<{ events: { kind: string }[] }>(`/api/tasks/${task.id}`);
    const kinds = detail.events.map((event) => event.kind);
    this.seen.set(task.id, { last: task.lastEvent, kinds });
    return kinds;
  }

  private forgetExcept(tasks: readonly FeedTask[]): void {
    const running = new Set(tasks.map((task) => task.id));
    for (const id of this.seen.keys()) if (!running.has(id)) this.seen.delete(id);
  }
}

/**
 * 처음 한 번, 그리고 신호가 올 때마다 read를 부른다. 읽기는 한 번에 하나만 돌고, 도는 중에 신호가 오면 끝난 뒤 한 번 더 읽는다.
 * 놓친 신호는 되돌아오지 않으므로 연결이 열릴 때마다 읽고, 숨은 탭은 읽지 않다가 돌아올 때 읽는다.
 * 돌려준 함수를 부르면 멈춘다.
 */
export function watchCairn(read: () => Promise<void>): () => void {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let flight = false;
  let again = false;
  let stopped = false;

  async function run(): Promise<void> {
    timer = null;
    if (stopped) return;
    if (document.hidden) return;
    if (flight) {
      again = true;
      return;
    }
    flight = true;
    try {
      do {
        again = false;
        await read();
      } while (again && !stopped);
    } finally {
      flight = false;
    }
  }

  function soon(): void {
    timer ??= setTimeout(() => void run(), REREAD_MS);
  }

  function open(): void {
    const stream = new EventSource('/api/stream');
    source = stream;
    stream.onopen = soon;
    stream.onmessage = (event) => {
      const signal = JSON.parse(event.data) as { topic: string };
      if (matches(signal.topic)) soon();
    };
    stream.onerror = () => {
      if (stream.readyState !== EventSource.CLOSED) return; // 끊긴 것뿐이면 브라우저가 다시 잇는다
      retry = setTimeout(open, REOPEN_MS);
    };
  }

  const back = () => {
    if (!document.hidden) soon();
  };

  void run();
  open();
  const every = setInterval(soon, HOLD_REREAD_MS);
  document.addEventListener('visibilitychange', back);

  return () => {
    stopped = true;
    source?.close();
    if (timer) clearTimeout(timer);
    if (retry) clearTimeout(retry);
    clearInterval(every);
    document.removeEventListener('visibilitychange', back);
  };
}
