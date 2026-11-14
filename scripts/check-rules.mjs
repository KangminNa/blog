// 규칙 검사 (.claude/rules/web.md · server.md, docs/객체설계.md 11장). pnpm check가 돌린다.
// 참고한 오픈소스의 장치를 가져왔다 (기획서 12장 2026-11-12): 줄어들기만 하는 예외 목록(ORCA · OpenClaw의 max-lines ratchet),
// 화면의 공통 처리를 스크립트로 강제(Paperclip의 check-query-error-rendering), 공유 타입은 import type만(ORCA).
//
//   1. 웹은 서버 코드를 import type으로만 가져온다 (값을 가져오면 서버 코드가 브라우저 묶음에 들어간다)
//   2. 웹은 응답 모양을 손으로 적지 않는다: api<{ … }> 금지. 서버 view에서 만든 타입을 쓴다
//   3. 웹의 쓰기는 useAction, 읽기는 useLiveValue. 손으로 쓴 busy 상태 · 불러오기는 예외 목록에 있는 파일만
//   4. 파일 하나의 코드는 MAX_LINES줄까지 (빈 줄 · 주석 · 시험 · 생성 파일 제외). 넘는 파일은 예외 목록에 적힌 줄 수까지만
//   5. 패턴 목록(객체설계 11장)이 본보기로 가리키는 파일이 실제로 있다
//   6. AI가 읽는 글은 코드에 두지 않는다 (2차 1-0): MCP 도구(*.tool.ts)의 설명 · 칸 설명은 <모듈>.tools.ko.json에
//
// 예외 목록(scripts/ratchet.json)은 줄어들기만 한다: 새 항목을 더하지 않고, 고친 파일은 목록에서 지운다.
// 목록의 why에는 아직 남은 화면마다 까닭을 적어 둔다 (검사는 보지 않는다).
//   node scripts/check-rules.mjs --update   고쳐서 벗어난 항목을 지우고 줄어든 줄 수를 적는다 (새 항목은 더하지 않는다)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ratchetFile = join(root, 'scripts/ratchet.json');
const patternDoc = join(root, 'docs/객체설계.md');
const MAX_LINES = 300;
const update = process.argv.includes('--update');
const problems = [];
const at = (file) => relative(root, file);

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'installed', 'templates']);
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** 빈 줄과 주석을 뺀 줄 수 */
function codeLines(text) {
  let count = 0;
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line === '' || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    count += 1;
  }
  return count;
}

const ratchet = JSON.parse(readFileSync(ratchetFile, 'utf8'));

// --- 웹 ---
const webFiles = [
  ...walk(join(root, 'apps/web/app')),
  ...readdirSync(join(root, 'plugins')).flatMap((p) => walk(join(root, 'plugins', p, 'web'))),
].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.generated\.ts$/.test(f));

const IMPORT = /import\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)'/g;
const SERVER_PATH = /(^|\/)server\/(src\/|[^/]+$)|\/server\//;
function checkWebImports(file, text) {
  for (const [, type, , from] of text.matchAll(IMPORT))
    if (!type && from.startsWith('.') && SERVER_PATH.test(from))
      problems.push(`${at(file)}: 서버 코드는 import type으로만 가져와요 (${from})`);
}

function checkHandWrittenReply(file, text) {
  if (/\b(api|serverGet|serverFetch|uploadFile)<\{/.test(text))
    problems.push(
      `${at(file)}: 응답 모양을 손으로 적었어요 (api<{ … }>). 서버 view에서 만든 타입을 app/_<모듈>/types.ts에 두고 써요`,
    );
}

/** 예외 목록 하나를 맞춰 본다: 걸리는 파일이 목록에 있어야 하고, 목록의 파일은 아직 걸려야 한다 */
function checkList(name, hits, hint) {
  const listed = new Set(ratchet[name]);
  for (const file of hits) if (!listed.has(file)) problems.push(`${file}: ${hint}`);
  const stale = [...listed].filter((file) => !hits.has(file));
  if (update) ratchet[name] = [...listed].filter((file) => hits.has(file)).sort();
  else
    for (const file of stale)
      problems.push(
        `${file}: 이제 규칙을 지켜요. scripts/ratchet.json의 ${name}에서 지워 주세요 (--update)`,
      );
}

const busyHits = new Set();
const loadHits = new Set();
for (const file of webFiles) {
  const text = readFileSync(file, 'utf8');
  checkWebImports(file, text);
  checkHandWrittenReply(file, text);
  // 공용 훅 자신은 보는 대상이 아니다
  if (at(file).startsWith('apps/web/app/_lib/')) continue;
  // 플러그인 화면은 react와 자기 폴더만 가져올 수 있어 공용 훅을 쓰지 못한다 (서버는 props의 call로 부른다)
  if (at(file).startsWith('plugins/')) continue;
  if (/\bsetBusy\(/.test(text)) busyHits.add(at(file));
  // 화면이 뜰 때 손으로 읽는 모양: useEffect와 GET 호출이 있는데 useLiveValue가 없다 (읽기 훅 파일 자신은 뺀다)
  const reads = /\bapi(<[^>]*>)?\(\s*'GET'/.test(text) && /\buseEffect\(/.test(text);
  if (reads && !/\buseLiveValue\b/.test(text)) loadHits.add(at(file));
}
checkList(
  'handWrittenBusy',
  busyHits,
  '쓰기는 useAction으로 (app/_lib/use-action.ts). busy 상태를 손으로 만들지 않아요',
);
checkList(
  'handWrittenLoad',
  loadHits,
  '읽기는 useLiveValue로 (app/_lib/use-live.ts). 불러오기를 손으로 쓰지 않아요',
);

// --- 파일 길이 ---
const sourceFiles = ['apps', 'packages', 'plugins', 'scripts']
  .flatMap((dir) => walk(join(root, dir)))
  .filter(
    (f) =>
      /\.(ts|tsx|mjs)$/.test(f) &&
      !/\.test\.(ts|tsx)$/.test(f) &&
      !/\.(tables|schema|generated)\.ts$/.test(f) &&
      !/\/e2e\//.test(f) &&
      !/\.d\.ts$/.test(f),
  );
const lengths = new Map(sourceFiles.map((f) => [at(f), codeLines(readFileSync(f, 'utf8'))]));
const longFiles = { ...ratchet.longFiles };
for (const [file, lines] of lengths) {
  if (lines <= MAX_LINES) continue;
  const allowed = ratchet.longFiles[file];
  if (allowed === undefined)
    problems.push(`${file}: 코드 ${lines}줄. ${MAX_LINES}줄을 넘으면 개념 단위로 파일을 나눠요`);
  else if (lines > allowed)
    problems.push(
      `${file}: 코드 ${lines}줄. 예외 목록의 ${allowed}줄보다 늘었어요. 늘리지 말고 나눠요`,
    );
  else if (update) longFiles[file] = lines;
}
for (const [file, allowed] of Object.entries(ratchet.longFiles)) {
  const lines = lengths.get(file);
  if (lines !== undefined && lines > MAX_LINES) continue;
  if (update) delete longFiles[file];
  else
    problems.push(
      `${file}: 이제 ${MAX_LINES}줄 안이에요 (전에는 ${allowed}줄). scripts/ratchet.json의 longFiles에서 지워 주세요 (--update)`,
    );
}
if (update) ratchet.longFiles = Object.fromEntries(Object.entries(longFiles).sort());

// --- 패턴 목록의 본보기 ---
const doc = readFileSync(patternDoc, 'utf8');
const start = doc.indexOf('### 패턴 목록');
if (start < 0) problems.push(`${at(patternDoc)}: "### 패턴 목록"을 찾지 못했어요`);
else {
  const rest = doc.slice(start + 1);
  const end = rest.search(/\n## /);
  const section = end < 0 ? rest : rest.slice(0, end);
  const BASES = ['', 'apps/server/src/modules', 'apps/web/app'];
  for (const [, path] of section.matchAll(/`([\w()[\]./-]+\/[\w()[\]./-]*)`/g)) {
    if (!/\.(ts|tsx|mjs|md)$|\/$/.test(path)) continue;
    if (!BASES.some((base) => existsSync(join(root, base, path))))
      problems.push(`${at(patternDoc)} 패턴 목록: 본보기 ${path}가 없어요`);
  }
}

// --- AI가 읽는 글 ---
// 도구의 설명과 입력 칸 설명은 설명서 파일(<모듈>.tools.ko.json)에 둔다. 콘솔에서 고친 판이 그 위에 얹힌다 (mcp 모듈)
// 기능 패키지의 도구(platform/plugin/package.tool.ts)는 글을 목록 파일(cairn-plugin.json)에서 받아 와서 뺀다
const toolFiles = walk(join(root, 'apps/server/src')).filter(
  (f) => f.endsWith('.tool.ts') && !at(f).startsWith('apps/server/src/modules/platform/'),
);
for (const file of toolFiles) {
  const text = readFileSync(file, 'utf8');
  if (/\bdescription\s*[:=]/.test(text))
    problems.push(
      `${at(file)}: 도구 설명은 코드에 두지 않아요. 모듈의 <모듈>.tools.ko.json에 적어요 (서버가 칸 이름으로 얹는다)`,
    );
}

if (update) {
  writeFileSync(ratchetFile, `${JSON.stringify(ratchet, null, 2)}\n`);
  console.log('예외 목록을 줄였어요 (scripts/ratchet.json)');
}
if (problems.length > 0) {
  console.error(`규칙 검사 위반 ${problems.length}건\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const left = ratchet.handWrittenBusy.length + ratchet.handWrittenLoad.length;
console.log(
  `규칙 검사 통과 (예외 목록: 긴 파일 ${Object.keys(ratchet.longFiles).length}개, 옮길 화면 ${left}곳)`,
);
