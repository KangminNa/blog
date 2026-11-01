'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type ApiReply, describe } from './client-api';

// 콘솔의 변경 신호 (API설계 6장). /api/stream은 { topic, id }만 보내고, 화면은 REST로 다시 읽는다.
// 놓친 신호는 되돌아오지 않으므로 연결이 열릴 때마다 다시 읽는다.

/** 신호가 몰릴 때 다시 읽는 간격 */
const REREAD_MS = 300;
/** 서버가 오류로 답하면 브라우저가 다시 잇기를 포기한다 (예: 서버 재시작 중의 502). 그때 다시 여는 간격 */
const REOPEN_MS = 3000;

type Signal = { topic: string; id: string };
/** signal이 null이면 연결이 (다시) 열렸다는 뜻: 놓쳤을 수 있으니 모두 다시 읽는다 */
type Receiver = (signal: Signal | null) => void;

/** 탭 하나에 연결 하나. 받는 쪽이 생기면 열고, 모두 떠나면 닫는다 */
class SignalStream {
  private readonly receivers = new Set<Receiver>();
  private source: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  add(receiver: Receiver): () => void {
    this.receivers.add(receiver);
    this.open();
    return () => {
      this.receivers.delete(receiver);
      if (this.receivers.size === 0) this.close();
    };
  }

  private open(): void {
    if (this.source || this.retry) return;
    const source = new EventSource('/api/stream');
    this.source = source;
    source.onopen = () => this.tell(null);
    source.onmessage = (event) => this.tell(JSON.parse(event.data) as Signal);
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return; // 끊긴 것뿐이면 브라우저가 다시 잇는다
      this.source = null;
      this.retry = setTimeout(() => {
        this.retry = null;
        this.open();
      }, REOPEN_MS);
    };
  }

  private close(): void {
    this.source?.close();
    this.source = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private tell(signal: Signal | null): void {
    for (const receive of [...this.receivers]) receive(signal);
  }
}

const stream = new SignalStream();

/** `task.approval.*`는 그 앞이 같은 주제 모두 */
function matches(patterns: readonly string[], topic: string): boolean {
  return patterns.some((p) => (p.endsWith('.*') ? topic.startsWith(p.slice(0, -1)) : p === topic));
}

/**
 * 맞는 신호가 오면 onChange를 부른다. id를 주면 그 대상의 신호만 본다.
 * 첫 신호 뒤 REREAD_MS마다 한 번씩 부른다: 신호가 끊임없이 와도 화면이 멈추지 않게 (끝나기를 기다리지 않는다).
 */
export function useLive(topics: readonly string[], onChange: () => void, id?: string): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const key = topics.join(' ');
  useEffect(() => {
    const patterns = key.split(' ');
    let timer: ReturnType<typeof setTimeout> | null = null;
    const remove = stream.add((signal) => {
      if (signal && !(matches(patterns, signal.topic) && (!id || signal.id === id))) return;
      timer ??= setTimeout(() => {
        timer = null;
        latest.current();
      }, REREAD_MS);
    });
    return () => {
      remove();
      if (timer) clearTimeout(timer);
    };
  }, [key, id]);
}

/** 화면이 읽은 값 하나. data는 다시 읽는 동안에도 앞의 값을 둔다 */
export type LiveValue<T> = {
  data: T | null;
  error: string | null;
  /** 마지막 응답의 상태 코드 (아직 없으면 null). 404를 빈 화면과 가른다 */
  status: number | null;
  reload: () => Promise<void>;
};

/**
 * 처음 한 번, 그리고 신호가 올 때마다 읽는다. key가 바뀌면 다른 값이므로 앞의 값을 버린다.
 * 읽기는 한 번에 하나만 돌고, 도는 중에 또 부르면 끝난 뒤 한 번 더 읽는다:
 * 늦게 온 옛 응답이 새 값을 덮지 않고, 응답이 느려도 화면이 멈추지 않는다.
 */
export function useLiveValue<T>(
  key: string,
  read: () => Promise<ApiReply<T>>,
  topics: readonly string[],
  id?: string,
): LiveValue<T> {
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    status: number | null;
  } | null>(null);
  const asked = useRef({ key, read });
  const flight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  useEffect(() => {
    asked.current = { key, read };
  });

  const reload = useCallback((): Promise<void> => {
    if (flight.current) {
      again.current = true;
      return flight.current;
    }
    const run = async () => {
      do {
        again.current = false;
        const { key: readKey, read: reader } = asked.current;
        const reply = await reader();
        if (asked.current.key !== readKey) {
          again.current = true; // 읽는 사이 다른 값으로 바뀌었다
          continue;
        }
        setState((before) =>
          reply.ok
            ? { key: readKey, data: reply.data, error: null, status: 200 }
            : {
                key: readKey,
                data: before?.key === readKey ? before.data : null,
                error: describe(reply.error),
                status: reply.status,
              },
        );
      } while (again.current);
    };
    flight.current = run().finally(() => {
      flight.current = null;
    });
    return flight.current;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: key가 바뀌면 새 값을 읽는다 (읽을 값은 asked에 있다)
  useEffect(() => {
    void reload();
  }, [key, reload]);

  useLive(topics, reload, id);

  const shown = state?.key === key ? state : null;
  return {
    data: shown?.data ?? null,
    error: shown?.error ?? null,
    status: shown?.status ?? null,
    reload,
  };
}
