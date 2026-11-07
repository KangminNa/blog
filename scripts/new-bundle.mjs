// 새 데이터 묶음(과 콘솔 메뉴)의 뼈대를 만든다. 객체설계 6장 "콘솔 메뉴 하나의 구조".
//
//   pnpm new:bundle <모듈>/<묶음> [--menu <그룹>/<이름>] [--tool] [--plural <복수형>]
//   예: pnpm new:bundle task/schedule --menu 운영/스케줄 --tool
//
// 파일만 만든다. 모듈 등록·도구 목록·메뉴 한 줄과 마이그레이션은 출력해서 사람이 넣는다
// (TS 파일을 스크립트로 고치면 깨지기 쉽고, 빠뜨리면 생성된 API 테스트가 404로 알려 준다).
// 표 인터페이스(<모듈>.tables.ts)에는 출력한 마이그레이션의 모양을 끝에 붙여 둔다. 그래서 만든 직후 pnpm check는
// 통과하고, 마이그레이션 뒤 pnpm db:rows가 그 파일을 DB에서 다시 만든다 (그 전에는 pnpm db:check가 알려 준다).
// pnpm test는 등록·마이그레이션 전이라 실패한다 (빨강에서 시작).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowTypeOf } from './table-name.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templates = join(root, 'scripts/templates/bundle');
const USAGE =
  '쓰는 법: pnpm new:bundle <모듈>/<묶음> [--menu <그룹>/<이름>] [--tool] [--plural <복수형>]';
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** 비즈니스 데이터를 갖지 않는 모듈 (platform은 공통 기반, mcp는 입구) */
const NO_BUNDLES = ['platform', 'mcp'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function options(argv) {
  const found = { tool: false, menu: null, plural: null, target: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--tool') found.tool = true;
    else if (arg === '--menu') found.menu = argv[++i] ?? fail(USAGE);
    else if (arg === '--plural') found.plural = argv[++i] ?? fail(USAGE);
    else if (arg.startsWith('--')) fail(`모르는 옵션: ${arg}\n${USAGE}`);
    else if (found.target) fail(USAGE);
    else found.target = arg;
  }
  if (!found.target) fail(USAGE);
  return found;
}

/** schedule → schedules, category → categories, class → classes */
function pluralOf(word) {
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

const capital = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/** 줄 단위 조건(//#if tool · //#else · //#endif)을 풀고 __자리__를 값으로 바꾼다 */
function render(text, vars, flags) {
  const lines = [];
  const stack = [];
  for (const line of text.split('\n')) {
    const mark = line.trim();
    const cond = /^\/\/#if (\w+)$/.exec(mark);
    if (cond) stack.push(Boolean(flags[cond[1]]));
    else if (mark === '//#else') stack.push(!stack.pop());
    else if (mark === '//#endif') stack.pop();
    else if (stack.every(Boolean)) lines.push(line);
  }
  return lines.join('\n').replace(/__([A-Za-z][A-Za-z_]*?)__/g, (all, key) => {
    if (!(key in vars)) fail(`템플릿에 모르는 자리: ${all}`);
    return vars[key];
  });
}

const opts = options(process.argv.slice(2));
const [module, bundle, extra] = opts.target.split('/');
const map = JSON.parse(read('apps/server/modules.json'));
if (extra !== undefined || !bundle) fail(USAGE);
if (!map.modules[module])
  fail(`modules.json에 없는 모듈이에요: ${module} (${Object.keys(map.modules).join(' · ')})`);
if (NO_BUNDLES.includes(module))
  fail(`${module}에는 비즈니스 데이터 묶음을 두지 않아요 (객체설계 9장)`);
if (!KEBAB.test(bundle))
  fail(`묶음 이름은 소문자·숫자·하이픈이에요 (예: schedule, plan-usage): ${bundle}`);
const plural = opts.plural ?? pluralOf(bundle);
if (!KEBAB.test(plural)) fail(`복수형도 소문자·숫자·하이픈이에요: ${plural}`);

const serverDir = join('apps/server/src/modules', module, bundle);
if (existsSync(join(root, serverDir))) fail(`이미 있는 묶음이에요: ${serverDir}`);

const menuPath = 'apps/web/app/admin/menu.tsx';
let menu = null;
if (opts.menu) {
  const [group, label, rest] = opts.menu.split('/');
  const menuFile = read(menuPath);
  const groups = [...menuFile.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  if (rest !== undefined || !label) fail(`--menu는 <그룹>/<이름>이에요 (예: 운영/스케줄)`);
  if (!groups.includes(group)) fail(`메뉴 그룹은 ${groups.join(' · ')} 중 하나예요: ${group}`);
  const href = `/admin/${plural}`;
  const webDir = join('apps/web/app/admin', plural);
  if (menuFile.includes(`'${href}'`) || existsSync(join(root, webDir)))
    fail(`이미 있는 메뉴예요: ${href}`);
  const icons = [...menuFile.matchAll(/^ {2}([a-z]+): /gm)].map((m) => m[1]);
  menu = { group, label, href, webDir, icons };
}

const words = bundle.split('-');
const Name = words.map(capital).join('');
const table = plural.replaceAll('-', '_');
const schema = map.modules[module].schemas[0];
const Table = rowTypeOf(table);
const tablesFile = `apps/server/src/modules/${module}/${module}.tables.ts`;
if (!existsSync(join(root, tablesFile)))
  fail(`표 인터페이스 파일이 없어요: ${tablesFile} (pnpm db:rows)`);
if (read(tablesFile).includes(`export interface ${Table}Row {`))
  fail(`이미 있는 표예요: ${schema}.${table} (${Table}Row). --plural로 다른 표 이름을 주세요`);
const vars = {
  Name,
  Table,
  module,
  bundle,
  plural,
  schema,
  table,
  label: menu?.label ?? bundle,
  action: `create_${bundle.replaceAll('-', '_')}`,
  tool: `list_${table}`,
  server_rel: '../../../../server/src/modules',
};

const server = [
  ['entity.ts', `${bundle}.ts`],
  ['view.ts', `${bundle}.view.ts`],
  ['input.ts', `${bundle}.input.ts`],
  ['repository.ts', `${bundle}.repository.ts`],
  ['service.ts', `${bundle}.service.ts`],
  ['query.ts', `${bundle}.query.ts`],
  ['api.ts', `${bundle}.api.ts`],
  ['api.test.ts', `${bundle}.api.test.ts`],
  ...(opts.tool ? [['tool.ts', `${bundle}.tool.ts`]] : []),
].map(([from, to]) => [`server/${from}.tmpl`, join(serverDir, to)]);
const web = menu
  ? [
      ['web/page.tsx.tmpl', join(menu.webDir, 'page.tsx')],
      ['web/panel.tsx.tmpl', join(menu.webDir, `${Name}Panel.tsx`)],
    ]
  : [];

const moduleFile = `apps/server/src/modules/${module}/${module}.module.ts`;
const toolsFile = `apps/server/src/modules/${module}/${module}-tools.ts`;
const importOf = (file) => `./${bundle}/${bundle}${file}`;
const steps = [
  `표: pnpm db:new create_${table} 로 파일을 만들고 (docs/테이블설계.md도 함께)
   -- migrate:up
   CREATE TABLE ${schema}.${table} (
     id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
     space_id uuid NOT NULL,
     name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
     version integer NOT NULL DEFAULT 1,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   -- migrate:down
   DROP TABLE ${schema}.${table};
   그다음 pnpm db:migrate, pnpm db:rows (${tablesFile} 끝에 붙여 둔 ${Table}Row를 DB에서 다시 만든다)`,
  `등록: ${moduleFile}
   import { ${Name}Controller } from '${importOf('.api')}';
   import { ${Name}Query } from '${importOf('.query')}';
   import { ${Name}Service } from '${importOf('.service')}';${
     opts.tool ? `\n   import { List${Name}Tool } from '${importOf('.tool')}';` : ''
   }
   providers에 ${Name}Service, ${Name}Query${opts.tool ? `, List${Name}Tool` : ''} / controllers에 ${Name}Controller`,
  ...(opts.tool
    ? [
        `도구 목록: ${toolsFile}${existsSync(join(root, toolsFile)) ? '' : ' (없으면 만들고 mcp 모듈에 모은다)'}에 List${Name}Tool.
   스킬이 이 도구를 쓰면 skills/의 설명도 함께 (AGENTS.md)`,
      ]
    : []),
  ...(menu
    ? [
        `메뉴: ${menuPath}의 '${menu.group}' 그룹에
   { href: '${menu.href}', name: '${menu.label}', icon: '<${menu.icons.join(' · ')}>' },`,
      ]
    : []),
  `규칙 문서: apps/server/src/modules/${module}/CLAUDE.md의 하는 일 · 소유 데이터 · 데이터 묶음`,
  `칸을 이 묶음의 것으로 바꾸고 pnpm check, pnpm test (${bundle}.api.test.ts는 등록 전에는 실패한다)`,
];

// 모두 그린 뒤에 쓴다: 템플릿 하나가 틀려도 반쯤 만든 묶음이 남지 않게
const rendered = [...server, ...web].map(([from, to]) => [
  to,
  render(readFileSync(join(templates, from), 'utf8'), vars, opts),
]);
const tableBlock = render(
  readFileSync(join(templates, 'server/tables.ts.tmpl'), 'utf8'),
  vars,
  opts,
);
const written = [];
for (const [to, text] of rendered) {
  mkdirSync(join(root, dirname(to)), { recursive: true });
  writeFileSync(join(root, to), text);
  written.push(to);
}
// 자동 생성 파일이라 포맷하지 않는다 (db:rows가 만드는 모양 그대로)
appendFileSync(join(root, tablesFile), `\n${tableBlock}`);

// 자리 값의 길이에 따라 줄 바꿈이 달라지므로 저장소의 포맷 규칙으로 맞춘다
const biome = join(root, 'node_modules/.bin/biome');
if (existsSync(biome))
  execFileSync(biome, ['check', '--write', ...written], { cwd: root, stdio: 'ignore' });

console.log(
  `만든 파일:\n${written.map((f) => `  ${relative(root, join(root, f))}`).join('\n')}\n붙인 곳:\n  ${tablesFile} (${Table}Row · ${Table}New)\n`,
);
console.log(`다음 할 일:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
