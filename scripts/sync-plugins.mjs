// 들어 있는 플러그인의 웹 화면을 웹 앱 안으로 옮기고, 화면 자리 목록을 만든다.
//
//   node scripts/sync-plugins.mjs
//
// 들어 있는 플러그인(plugins/ 안 전부)의 화면을 넣는다. 켜졌는지는 그릴 때 서버에 묻기 때문에
// 켜고 끌 때 웹을 다시 빌드하지 않는다. 새 플러그인을 넣었을 때만 다시 실행된다(웹 시작·빌드 때 자동).
//
// 결과: apps/web/app/_plugins/installed/<이름>/…  (복사본, git에 올리지 않음)
//       apps/web/app/_plugins/slots.generated.ts   (자동 생성, git에 올리지 않음)
// 목록 파일의 자세한 검사는 서버가 시작할 때 한다. 여기서는 웹에 필요한 것만 본다.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const pluginsDir = join(root, 'plugins');
const target = join(root, 'apps/web/app/_plugins');
const installed = join(target, 'installed');

const names = readdirSync(pluginsDir)
  .filter((n) => existsSync(join(pluginsDir, n, 'cairn-plugin.json')))
  .sort();

rmSync(installed, { recursive: true, force: true });
mkdirSync(installed, { recursive: true });

const imports = [];
const slots = new Map();
for (const name of names) {
  const dir = join(pluginsDir, name);
  const manifestFile = join(dir, 'cairn-plugin.json');
  if (!existsSync(manifestFile))
    throw new Error(`플러그인 ${name}의 목록 파일이 없어요: ${manifestFile}`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (manifest.name !== name)
    throw new Error(`폴더 이름(${name})과 플러그인 이름(${manifest.name})이 달라요`);
  const web = manifest.web ?? {};
  if (Object.keys(web).length === 0) continue;
  cpSync(join(dir, 'web'), join(installed, name), { recursive: true });
  for (const [slot, file] of Object.entries(web)) {
    const id = `P${imports.length}`;
    const path = `./installed/${name}/${String(file)
      .replace(/^web\//, '')
      .replace(/\.tsx?$/, '')}`;
    imports.push(`import ${id} from '${path}';`);
    if (!slots.has(slot)) slots.set(slot, []);
    slots.get(slot).push(`{ plugin: '${name}', Component: ${id} }`);
  }
}

const body = [...slots]
  .map(([slot, entries]) => `  '${slot}': [${entries.join(', ')}],`)
  .join('\n');
writeFileSync(
  join(target, 'slots.generated.ts'),
  `// 자동 생성 파일: scripts/sync-plugins.mjs가 만든다. 직접 고치지 않는다.
import type { SlotEntry } from './slot-types';
${imports.join('\n')}

export const SLOTS: Readonly<Record<string, readonly SlotEntry[]>> = {
${body}
};
`,
);
console.log(`플러그인 화면 준비: ${names.length ? names.join(', ') : '(플러그인 없음)'}`);
