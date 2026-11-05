// 구조 검사 (docs/객체설계.md 6장 "파일 구조"와 "콘솔 메뉴 하나의 구조"). pnpm check가 돌린다.
//
//   1. 모듈 안의 파일 이름은 .api · .input · .view (옛 .controller · .request · .response는 쓰지 않는다)
//   2. REST 진입(.api.ts) 옆에는 같은 이름의 .api.test.ts. 다른 파일에서 시험하면
//      TESTED_ELSEWHERE에 그 파일을 적는다 (적은 파일이 없으면 실패)
//   3. 콘솔 메뉴(app/admin/menu.tsx의 href)와 app/admin/<주소>/page.tsx가 하나씩 맞는다
//   4. 웹은 서버 응답 모양을 손으로 적지 않는다: app/_lib/types.ts에는 HAND_WRITTEN_TYPES(오류 모양)만.
//      응답 타입은 서버 view에서 import type으로 만든다 (ReturnType<XxxView['toJSON']>, app/_<모듈>/types.ts)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = join(root, 'apps/server/src/modules');
const adminDir = join(root, 'apps/web/app/admin');

/** 옆이 아닌 곳에서 시험하는 REST 진입 → 그 테스트 파일 (modules/ 아래). 흐름 하나를 여러 진입이 함께 이룰 때 */
const TESTED_ELSEWHERE = {
  // OAuth 흐름(등록 → 승인 → 토큰)과 MCP 입구는 기기 연결 테스트가 처음부터 끝까지 본다
  'account/device/oauth.api.ts': 'account/device/device.api.test.ts',
  'mcp/mcp.api.ts': 'account/device/device.api.test.ts',
  // 로그인 · 블로그 정보는 설치 마법사 흐름에서
  'account/owner/login.api.ts': 'account/space/install.api.test.ts',
  'account/space/space.api.ts': 'account/space/install.api.test.ts',
  // 작업 · 결재 · 에이전트와 그 변경 신호는 작업 흐름 하나로
  'platform/stream/stream.api.ts': 'task/task.api.test.ts',
  'task/agent/agent.api.ts': 'task/task.api.test.ts',
  'task/approval/approval.api.ts': 'task/task.api.test.ts',
  'task/task/task.api.ts': 'task/task.api.test.ts',
};

/** app/_lib/types.ts에 손으로 적어도 되는 타입: 오류 모양(DomainError.toJSON)은 view가 아니라 모든 실패 응답의 모양이다 */
const HAND_WRITTEN_TYPES = ['ApiError'];

const OLD_SUFFIX = /\.(controller|request|response)\.ts$/;
const ENTRY = /\.api\.ts$/;
const problems = [];
const at = (file) => relative(root, file);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function checkNames(files) {
  for (const file of files)
    if (OLD_SUFFIX.test(file))
      problems.push(
        `${at(file)} 옛 이름. .api(Controller + Response) · .input · .view로 (객체설계 6장, pnpm new:bundle)`,
      );
}

function checkTests(files) {
  const seen = new Set();
  for (const file of files) {
    if (!ENTRY.test(file)) continue;
    const key = relative(modulesDir, file);
    const beside = file.replace(ENTRY, '.api.test.ts');
    const elsewhere = TESTED_ELSEWHERE[key];
    if (elsewhere) {
      seen.add(key);
      if (!existsSync(join(modulesDir, elsewhere)))
        problems.push(`${at(file)} TESTED_ELSEWHERE의 테스트 파일이 없어요: ${elsewhere}`);
    } else if (!existsSync(beside))
      problems.push(
        `${at(file)} 옆에 ${relative(dirname(file), beside)}가 없어요 (보는 사람별 결과: 방문자 · write 기기 · 주인)`,
      );
  }
  for (const key of Object.keys(TESTED_ELSEWHERE))
    if (!seen.has(key))
      problems.push(
        `scripts/check-structure.mjs TESTED_ELSEWHERE의 ${key}가 없어요. 목록에서 지워 주세요`,
      );
}

function checkMenu() {
  const menu = readFileSync(join(adminDir, 'menu.tsx'), 'utf8');
  const hrefs = new Set([...menu.matchAll(/href: (?:'([^']+)'|(\w+_HREF))/g)].map(hrefOf(menu)));
  const pages = new Set(['/admin']);
  for (const name of readdirSync(adminDir))
    if (existsSync(join(adminDir, name, 'page.tsx'))) pages.add(`/admin/${name}`);
  for (const href of hrefs)
    if (!pages.has(href))
      problems.push(`app/admin/menu.tsx ${href}의 화면이 없어요 (app${href}/page.tsx)`);
  for (const page of pages)
    if (!hrefs.has(page))
      problems.push(`app${page}/page.tsx 메뉴에 없는 화면이에요 (app/admin/menu.tsx에 한 줄)`);
}

/** href: '/admin/x' 또는 href: HOME_HREF 같은 상수 */
function hrefOf(menu) {
  return ([, literal, constant]) => {
    if (literal) return literal;
    const value = new RegExp(`const ${constant} = '([^']+)'`).exec(menu)?.[1];
    if (!value) problems.push(`app/admin/menu.tsx ${constant}의 값을 찾지 못했어요`);
    return value ?? constant;
  };
}

function checkWebTypes() {
  const file = join(root, 'apps/web/app/_lib/types.ts');
  const names = [...readFileSync(file, 'utf8').matchAll(/^export (?:type|interface) (\w+)/gm)].map(
    (m) => m[1],
  );
  for (const name of names)
    if (!HAND_WRITTEN_TYPES.includes(name))
      problems.push(
        `${at(file)} ${name}: 손으로 적은 API 타입. 서버 view에서 import type으로 (ReturnType<XxxView['toJSON']>, app/_<모듈>/types.ts)`,
      );
}

const files = walk(modulesDir).filter((f) => f.endsWith('.ts'));
checkNames(files);
checkTests(files);
checkMenu();
checkWebTypes();

if (problems.length > 0) {
  console.error(`구조 검사 위반 ${problems.length}건\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('구조 검사 통과');
