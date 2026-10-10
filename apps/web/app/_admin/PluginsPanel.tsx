'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { api, describe } from '../_lib/client-api';
import type { ActionResult, Plugin, PluginSetting } from '../_lib/types';

// 플러그인 켜기·설정·관리 동작. 설치 마법사의 5단계와 관리 모드의 "플러그인" 시트가 함께 쓴다.
// 켜기 전에 플러그인이 쓰는 권한을 보여주고, 켜는 순간 그 권한을 허락한 것으로 기록된다.
export function PluginsPanel({ onMessage }: { onMessage: (text: string) => void }) {
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const reply = await api<{ plugins: Plugin[] }>('GET', '/api/plugins');
    if (reply.ok) setPlugins(reply.data.plugins);
    else setError(describe(reply.error));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!plugins) return <p className="label-mono">불러오는 중…</p>;
  if (plugins.length === 0) return <p className="label-mono">들어 있는 플러그인이 없어요</p>;
  return (
    <div>
      {plugins.map((p) => (
        <PluginRow key={p.name} plugin={p} reload={load} onMessage={onMessage} />
      ))}
    </div>
  );
}

function PluginRow({
  plugin,
  reload,
  onMessage,
}: {
  plugin: Plugin;
  reload: () => Promise<void>;
  onMessage: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const reply = await api(
      'POST',
      `/api/plugins/${plugin.name}/${plugin.enabled ? 'disable' : 'enable'}`,
    );
    setBusy(false);
    if (!reply.ok) return setError(describe(reply.error));
    onMessage(plugin.enabled ? `${plugin.name}을(를) 껐어요` : `${plugin.name}을(를) 켰어요`);
    if (!plugin.enabled) setOpen(true);
    await reload();
  }

  const status = !plugin.enabled
    ? '꺼짐'
    : plugin.needsGrant.length > 0
      ? '다시 허락 필요'
      : plugin.missing.length > 0
        ? `설정 필요: ${plugin.missing.join(', ')}`
        : '켜짐';

  return (
    <section className="plugin" aria-label={plugin.name}>
      <div className="plugin-head">
        <div>
          <b>{plugin.name}</b>{' '}
          <span className="label-mono">
            {plugin.version} · {status}
          </span>
          <p>{plugin.description}</p>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={plugin.enabled}
          aria-label={`${plugin.name} ${plugin.enabled ? '끄기' : '켜기'}`}
          disabled={busy}
          onClick={toggle}
        />
      </div>
      {plugin.useLabels.length > 0 && (!plugin.enabled || plugin.needsGrant.length > 0) && (
        <ul className="uses" aria-label="켜면 허락하는 것">
          {plugin.useLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      {plugin.settings.length > 0 && (
        <button type="button" className="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          설정 {open ? '접기' : '열기'}
        </button>
      )}
      {open && <SettingsForm plugin={plugin} reload={reload} onMessage={onMessage} />}
      {plugin.actions.length > 0 && <Actions plugin={plugin} />}
    </section>
  );
}

function SettingsForm({
  plugin,
  reload,
  onMessage,
}: {
  plugin: Plugin;
  reload: () => Promise<void>;
  onMessage: (text: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const reply = await api('PUT', `/api/plugins/${plugin.name}/settings`, { values });
    setBusy(false);
    if (!reply.ok) return setError(describe(reply.error));
    setValues({});
    onMessage('설정을 저장했어요. 재시작 없이 바로 반영돼요');
    await reload();
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {plugin.settings.map((s) => (
        <SettingField
          key={s.key}
          setting={s}
          value={values[s.key]}
          onChange={(v) => setValues({ ...values, [s.key]: v })}
        />
      ))}
      {error && <p className="error">{error}</p>}
      <button className="cta" type="submit" disabled={busy || Object.keys(values).length === 0}>
        <span>{busy ? '저장하는 중' : '설정 저장'}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}

function SettingField({
  setting: s,
  value,
  onChange,
}: {
  setting: PluginSetting;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const label = `${s.label}${s.required ? ' *' : ''}`;
  if (s.type === 'boolean')
    return (
      <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input
          id={id}
          type="checkbox"
          checked={(value ?? s.value) === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <label htmlFor={id}>{label}</label>
      </div>
    );
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {s.type === 'select' ? (
        <select
          id={id}
          className="input"
          value={value ?? s.value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">(고르지 않음)</option>
          {s.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="input"
          type={s.type === 'secret' ? 'password' : 'text'}
          autoComplete="off"
          value={value ?? (s.type === 'secret' ? '' : (s.value ?? ''))}
          placeholder={s.type === 'secret' && s.isSet ? '설정됨 (바꿀 때만 입력)' : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {s.help && <small>{s.help}</small>}
    </div>
  );
}

function Actions({ plugin }: { plugin: Plugin }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(name: string) {
    setBusy(name);
    const reply = await api<ActionResult>('POST', `/api/plugins/${plugin.name}/actions/${name}`);
    setBusy(null);
    setResult(reply.ok ? reply.data : { ok: false, message: describe(reply.error), details: [] });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row">
        {plugin.actions.map((a) => (
          <button
            key={a.name}
            type="button"
            className="ghost"
            disabled={busy !== null}
            onClick={() => run(a.name)}
          >
            {busy === a.name ? '하는 중…' : a.label}
          </button>
        ))}
      </div>
      {result && (
        <div className="result" role="status">
          <b style={{ color: result.ok ? 'var(--moss)' : 'var(--danger)' }}>{result.message}</b>
          {result.details.length > 0 && (
            <ul>
              {result.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
