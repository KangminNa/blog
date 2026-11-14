'use client';

import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useDevices } from '../../_account/live';
import type { Device, DeviceSaved, SpaceInfo } from '../../_account/types';
import { api } from '../../_lib/client-api';
import { SCOPE_LABELS } from '../../_lib/types';
import { useAction } from '../../_lib/use-action';
import { ConnectGuide } from './ConnectGuide';

/** 켤 수 있는 권한. delegate: 이 기기의 AI 도구가 서버 팀에 일을 맡기고 답을 받는다 (MCP ask_agent, 결재는 콘솔에서만) */
const SCOPES = ['upload', 'read_public', 'read_all', 'tidy', 'write', 'run', 'delegate'];
/** 정해진 권한: 코드 러너 칸(sandbox) · 소식 기기(news). 관리자가 주거나 뺄 수 없다 (서버가 거절한다) */
const FIXED: Record<string, string> = { sandbox: '칸 기기', news: '소식 기기' };
/** 권한 바꾸기 · 마지막 로그인에는 변경 신호가 없다. 첫 기기가 붙기를 기다리는 동안에도 이 간격으로 읽는다 */
const REREAD_MS = 4000;

// 기기: 연결하는 법(도구별), 연결된 기기의 권한 바꾸기·끊기, 예비 기기 토큰.
// 설치 마법사의 마지막 단계도 이 목록을 보며 첫 기기가 붙기를 기다린다.
export function DevicesPanel({
  siteUrl,
  runners = false,
  onMessage,
  onChange,
  onSpaceChange,
}: {
  siteUrl: string | null;
  /** 러너 추가를 보여 준다 (콘솔). 설치 마법사는 첫 기기를 기다리므로 보이지 않는다 */
  runners?: boolean;
  onMessage: (text: string) => void;
  onChange?: (devices: Device[]) => void;
  onSpaceChange?: (space: SpaceInfo) => void;
}) {
  const read = useDevices();
  // 줄의 동작과 러너 추가는 함께 돌 수 있다. 오류는 한 자리에 뒤의 것을 보인다
  const action = useAction();
  const runner = useAction();
  const [spare, setSpare] = useState<{ name: string; token: string; runner?: boolean } | null>(
    null,
  );
  const { reload } = read;
  const devices = read.data?.devices ?? null;
  const error = runner.problem ?? action.problem ?? read.error;

  useEffect(() => {
    const timer = setInterval(() => void reload(), REREAD_MS);
    return () => clearInterval(timer);
  }, [reload]);

  // 읽을 때마다 알린다 (설치 마법사가 첫 기기를 기다린다)
  useEffect(() => {
    if (devices) onChange?.(devices);
  }, [devices, onChange]);

  /** 기기 하나를 바꾼다. 됐으면 바뀐 기기 */
  async function change(device: Device, method: string, path: string, body?: object) {
    runner.clear();
    const reply = await action.run(device.id, () => api<DeviceSaved>(method, path, body), {
      reload,
    });
    return reply?.ok ? reply.data : null;
  }

  async function toggle(device: Device, scope: string) {
    const scopes = device.scopes.includes(scope)
      ? device.scopes.filter((s) => s !== scope)
      : [...device.scopes, scope];
    if (
      await change(device, 'PATCH', `/api/devices/${device.id}`, {
        scopes,
        version: device.version,
      })
    )
      onMessage(`${device.name}의 권한을 바꿨어요`);
  }

  async function revoke(device: Device) {
    if (await change(device, 'POST', `/api/devices/${device.id}/revoke`))
      onMessage(`${device.name} 연결을 끊고 토큰을 바로 막았어요`);
  }

  async function issue(device: Device) {
    const saved = await change(device, 'POST', `/api/devices/${device.id}/token`);
    if (saved?.token) setSpare({ name: device.name, token: saved.token });
  }

  // 이름이 겹치면 409: conflict를 주지 않아 서버의 문구(그 이름)가 그대로 보인다
  async function addRunner(name: string, requestId: string): Promise<boolean> {
    action.clear();
    const reply = await runner.run(
      'add',
      () => api<DeviceSaved>('POST', '/api/devices/runner', { requestId, name }),
      { reload },
    );
    if (!reply?.ok) return false;
    if (reply.data.token)
      setSpare({ name: reply.data.name, token: reply.data.token, runner: true });
    onMessage(`${reply.data.name} 추가함`);
    return true;
  }

  const live = devices?.filter((d) => !d.revokedAt) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ConnectGuide siteUrl={siteUrl} onMessage={onMessage} onSpaceChange={onSpaceChange} />
      {runners && <AddRunner busy={runner.busy !== null} add={addRunner} />}
      {error && <p className="error">{error}</p>}
      {spare && (
        <div className="result" role="status">
          <b>{spare.name} 예비 토큰 (한 번만 보여줘요)</b>
          <div className="copy" style={{ marginTop: 8 }}>
            <code>{spare.token}</code>
          </div>
          {spare.runner && <p className="note">러너의 CAIRN_RUNNER_TOKEN에 넣어요</p>}
        </div>
      )}
      {devices === null ? (
        <p className="label-mono">불러오는 중…</p>
      ) : live.length === 0 ? (
        <p className="label-mono">연결한 기기 없음</p>
      ) : (
        live.map((d) => (
          <section key={d.id} className="plugin" aria-label={d.name}>
            <div className="plugin-head">
              <div>
                <b>{d.name}</b> <span className="label-mono">{d.client}</span>
                <p>
                  연결 {new Date(d.createdAt).toLocaleDateString('ko-KR')}
                  {d.lastUsedAt
                    ? ` · 마지막 로그인 ${new Date(d.lastUsedAt).toLocaleString('ko-KR')}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                disabled={action.busy === d.id}
                onClick={() => revoke(d)}
              >
                연결 해제
              </button>
            </div>
            {fixedOf(d) ? (
              <p className="label-mono">
                {d.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(' · ')} ({fixedOf(d)}는 바꿀 수
                없음)
              </p>
            ) : (
              <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="sr">권한</legend>
                {SCOPES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    aria-pressed={d.scopes.includes(s)}
                    disabled={action.busy === d.id}
                    onClick={() => toggle(d, s)}
                  >
                    {SCOPE_LABELS[s]}
                  </button>
                ))}
              </fieldset>
            )}
            <button
              type="button"
              className="ghost"
              disabled={action.busy === d.id}
              onClick={() => issue(d)}
            >
              예비 토큰 만들기 (OAuth를 못 쓰는 도구용)
            </button>
          </section>
        ))
      )}
    </div>
  );
}

/** 러너: 일을 빌리는 권한만 가진 기기. 이름이 같으면 서버가 거절한다. 추가는 패널이 돌린다 (add) */
function AddRunner({
  busy,
  add,
}: {
  busy: boolean;
  add: (name: string, requestId: string) => Promise<boolean>;
}) {
  const id = useId();
  const [name, setName] = useState('러너');
  // 응답을 놓쳐 다시 눌러도 러너는 하나다. 이름을 바꾸면 다른 요청이다
  const requestId = useRef<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    requestId.current ??= crypto.randomUUID();
    if (await add(name.trim(), requestId.current)) requestId.current = null;
  }

  return (
    <form className="row" onSubmit={submit}>
      <label className="sr" htmlFor={`${id}-name`}>
        러너 이름
      </label>
      <input
        id={`${id}-name`}
        className="input"
        value={name}
        maxLength={60}
        onChange={(e) => {
          requestId.current = null;
          setName(e.target.value);
        }}
      />
      <button type="submit" className="ghost" disabled={busy || !name.trim()}>
        러너 추가
      </button>
    </form>
  );
}

/** 권한이 정해진 기기의 이름 (칸 기기 · 소식 기기). 바꿀 수 있으면 null */
function fixedOf(device: Device): string | null {
  const scope = device.scopes.find((s) => FIXED[s]);
  return scope ? (FIXED[scope] ?? null) : null;
}
