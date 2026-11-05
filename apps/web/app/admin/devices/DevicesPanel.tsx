'use client';

import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Device, SpaceInfo } from '../../_account/types';
import { api, describe } from '../../_lib/client-api';
import { SCOPE_LABELS } from '../../_lib/types';
import { ConnectGuide } from './ConnectGuide';

const SCOPES = ['upload', 'read_public', 'read_all', 'tidy', 'write', 'run'];

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
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spare, setSpare] = useState<{ name: string; token: string; runner?: boolean } | null>(
    null,
  );

  const load = useCallback(async () => {
    const reply = await api<{ devices: Device[] }>('GET', '/api/devices');
    if (!reply.ok) return setError(describe(reply.error));
    setDevices(reply.data.devices);
    onChange?.(reply.data.devices);
  }, [onChange]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  async function call(path: string, method: string, body?: object): Promise<Device | null> {
    const reply = await api<Device & { token?: string }>(method, path, body);
    if (!reply.ok) {
      setError(describe(reply.error));
      return null;
    }
    setError(null);
    await load();
    return reply.data;
  }

  async function toggle(device: Device, scope: string) {
    const scopes = device.scopes.includes(scope)
      ? device.scopes.filter((s) => s !== scope)
      : [...device.scopes, scope];
    if (await call(`/api/devices/${device.id}`, 'PATCH', { scopes, version: device.version }))
      onMessage(`${device.name}의 권한을 바꿨어요`);
  }

  async function revoke(device: Device) {
    if (await call(`/api/devices/${device.id}/revoke`, 'POST'))
      onMessage(`${device.name} 연결을 끊고 토큰을 바로 막았어요`);
  }

  async function issue(device: Device) {
    const result = (await call(`/api/devices/${device.id}/token`, 'POST')) as
      | (Device & { token?: string })
      | null;
    if (result?.token) setSpare({ name: device.name, token: result.token });
  }

  async function addRunner(name: string, requestId: string): Promise<boolean> {
    const result = (await call('/api/devices/runner', 'POST', { requestId, name })) as
      | (Device & { token?: string })
      | null;
    if (!result) return false;
    if (result.token) setSpare({ name: result.name, token: result.token, runner: true });
    onMessage(`${result.name} 추가함`);
    return true;
  }

  const live = devices?.filter((d) => !d.revokedAt) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ConnectGuide siteUrl={siteUrl} onMessage={onMessage} onSpaceChange={onSpaceChange} />
      {runners && <AddRunner add={addRunner} />}
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
              <button type="button" className="ghost" onClick={() => revoke(d)}>
                끊기
              </button>
            </div>
            <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="sr">권한</legend>
              {SCOPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  aria-pressed={d.scopes.includes(s)}
                  onClick={() => toggle(d, s)}
                >
                  {SCOPE_LABELS[s]}
                </button>
              ))}
            </fieldset>
            <button type="button" className="ghost" onClick={() => issue(d)}>
              예비 토큰 만들기 (OAuth를 못 쓰는 도구용)
            </button>
          </section>
        ))
      )}
    </div>
  );
}

/** 러너: 일을 빌리는 권한만 가진 기기. 이름이 같으면 서버가 거절한다 */
function AddRunner({ add }: { add: (name: string, requestId: string) => Promise<boolean> }) {
  const id = useId();
  const [name, setName] = useState('러너');
  const [busy, setBusy] = useState(false);
  // 응답을 놓쳐 다시 눌러도 러너는 하나다. 이름을 바꾸면 다른 요청이다
  const requestId = useRef<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    requestId.current ??= crypto.randomUUID();
    const added = await add(name.trim(), requestId.current);
    setBusy(false);
    if (added) requestId.current = null;
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
