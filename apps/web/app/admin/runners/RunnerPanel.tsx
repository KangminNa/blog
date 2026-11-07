'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AiToolListView } from '../../../../server/src/modules/task/ai/ai-login.view';
import type { Device } from '../../_account/types';
import { api, describe } from '../../_lib/client-api';
import { when } from '../../_task/labels';
import type { Runner, RunnerList } from '../../_task/types';
import { useNotify } from '../AdminShell';

/** 서버 러너의 기기 이름 (서버의 Device.SERVER_RUNNER) */
const SERVER_RUNNER = '서버 러너';
/** 연결 상태는 시간이 지나며 바뀌는데 신호가 없다. 이 간격으로 다시 읽는다 */
const REREAD_MS = 15_000;

type AiTools = ReturnType<AiToolListView['toJSON']>;

/** 러너 하나와 그 기기 (이름·종류는 기기 목록에 있다) */
type Row = { runner: Runner; device: Device };

// 러너: 연결 상태, 지금 하는 일, 일 받기 켜기·끄기. 웹은 러너 프로세스를 켜지 않고, 서버가 일을 줄지 말지만 정한다.
export function RunnerPanel() {
  const notify = useNotify();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** AI 로그인이 하나라도 있는가. 없으면 러너는 연결돼 있어도 웹 로그인 말고는 일을 빌리지 않는다 (서버가 주지 않는다) */
  const [hasAiToken, setHasAiToken] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const [runners, devices, ai] = await Promise.all([
      api<RunnerList>('GET', '/api/runners'),
      api<{ devices: Device[] }>('GET', '/api/devices'),
      api<AiTools>('GET', '/api/ai'),
    ]);
    if (!runners.ok) return setError(describe(runners.error));
    if (!devices.ok) return setError(describe(devices.error));
    setError(null);
    if (ai.ok) setHasAiToken(ai.data.tools.some((t) => t.connected));
    // 끊긴 기기의 러너는 보이지 않는다 (서버 러너는 끊기면 새 기기로 다시 연결한다)
    const live = new Map(
      devices.data.devices.filter((d) => d.revokedAt === null).map((d) => [d.id, d]),
    );
    setRows(
      runners.data.runners.flatMap((runner) => {
        const device = live.get(runner.deviceId);
        return device ? [{ runner, device }] : [];
      }),
    );
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REREAD_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function flip({ runner, device }: Row) {
    setBusy(runner.id);
    setError(null);
    const reply = await api('POST', `/api/runners/${runner.id}/accepting`, {
      accepting: !runner.accepting,
      version: runner.version,
    });
    await load();
    setBusy(null);
    if (reply.ok) return notify(`${device.name} 일 받기 ${runner.accepting ? '꺼짐' : '켜짐'}`);
    setError(
      reply.status === 409
        ? '이미 바뀐 러너예요. 최신 내용을 다시 읽었어요'
        : describe(reply.error),
    );
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {hasAiToken === false && (
        <p className="warn">
          AI 로그인이 없어 러너가 일을 빌리지 않아요 ·{' '}
          <Link href="/admin/ai">AI 메뉴에서 로그인</Link>
        </p>
      )}
      {rows === null ? (
        !error && <p className="label-mono">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <div className="panel">
          <b>러너 없음</b>
          <p className="note">
            서버 러너는 서버와 함께 떠서 스스로 연결해요. 잠시 뒤에도 보이지 않으면 서버의 러너
            로그를 확인해 주세요
          </p>
        </div>
      ) : (
        <ul className="list" aria-label="러너 목록">
          {rows.map((row) => (
            <li key={row.runner.id}>
              <RunnerRow row={row} busy={busy === row.runner.id} onFlip={() => flip(row)} />
            </li>
          ))}
        </ul>
      )}
      <p className="note">
        에이전트의 AI 도구에 로그인이 있어야 그 일을 해요 · <Link href="/admin/ai">AI 메뉴</Link>.
        일 받기를 끄면 하던 일은 끝까지 하고 새 일은 받지 않아요
      </p>
    </>
  );
}

function RunnerRow({
  row: { runner, device },
  busy,
  onFlip,
}: {
  row: Row;
  busy: boolean;
  onFlip: () => void;
}) {
  const server = device.client === SERVER_RUNNER;
  return (
    <article className="panel" style={{ border: 0, borderRadius: 0 }} aria-label={device.name}>
      <div className="agent-top">
        <div className="item-main">
          <b>{device.name}</b>
          <small>
            {server ? '배포 서버 안' : '내 컴퓨터 등'} · 마지막 연결 {when(runner.lastSeenAt)}
          </small>
        </div>
        <span className={runner.online ? 'pill on' : 'pill off'}>
          {runner.online ? '연결됨' : '연결 안 됨'}
        </span>
        <span className={runner.accepting ? 'pill strong' : 'pill off'}>
          {runner.accepting ? '일 받는 중' : '쉬는 중'}
        </span>
      </div>
      {runner.task ? (
        <p className="note">
          지금 하는 일: <Link href={`/admin/tasks/${runner.task.id}`}>{runner.task.title}</Link>
        </p>
      ) : (
        <p className="note">지금 하는 일 없음</p>
      )}
      <div className="row">
        <button type="button" className="ghost" disabled={busy} onClick={onFlip}>
          {runner.accepting ? '일 받기 끄기' : '일 받기 켜기'}
        </button>
      </div>
    </article>
  );
}
