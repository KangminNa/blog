import type { SlotContext } from './slot-types';
import { SLOTS } from './slots.generated';

// 화면 자리. 켜진 플러그인 중 이 자리에 화면을 둔 것을 차례로 그린다.
// 플러그인의 공개 설정은 서버(/plugins/<이름>/settings)에서 받아 넘긴다.
export async function Slot({ name, context }: { name: string; context: SlotContext }) {
  const entries = SLOTS[name] ?? [];
  if (entries.length === 0) return null;
  const loaded = await Promise.all(
    entries.map(async (entry) => ({ ...entry, settings: await loadSettings(entry.plugin) })),
  );
  return (
    <>
      {loaded.map(({ plugin, Component, settings }) =>
        settings ? <Component key={plugin} settings={settings} context={context} /> : null,
      )}
    </>
  );
}

async function loadSettings(plugin: string): Promise<Record<string, string> | null> {
  const base = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/plugins/${plugin}/settings`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { settings?: Record<string, string> };
    return body.settings ?? {};
  } catch {
    return null;
  }
}
