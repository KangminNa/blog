// 모듈 경계 검사 (docs/객체설계.md 모듈 규칙). 모듈 지도는 apps/server/modules.json.
//
//   node scripts/check-boundaries.mjs        코드 검사
//   node scripts/check-boundaries.mjs --db   DB 검사 (모듈 사이 외래키, 주인 없는 스키마). Docker의 db가 떠 있어야 함
//
// 코드 검사 항목
//   1. 다른 모듈은 index.ts로만 가져온다
//   2. modules.json의 dependsOn에 있는 모듈만 가져온다
//   3. 외부 라이브러리는 platform/base 안에서만 가져온다 (프레임워크 제외)
//   4. SQL(sql`…`, tx`…`)은 자기 모듈이 소유한 스키마만 쓴다
//   5. 플러그인(plugins/<이름>/)은 자기 폴더 안의 파일, react(화면), node:*·apps/server/src/plugin-api(서버)만 가져온다
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const serverSrc = join(root, 'apps/server/src');
const modulesDir = join(serverSrc, 'modules');
const map = JSON.parse(readFileSync(join(root, 'apps/server/modules.json'), 'utf8'));
const moduleNames = Object.keys(map.modules);
const allSchemas = moduleNames.flatMap((m) => map.modules[m].schemas);
const problems = [];

if (process.argv.includes('--db')) checkDatabase();
else checkCode();

if (problems.length > 0) {
  console.error(`모듈 경계 위반 ${problems.length}건\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('모듈 경계 검사 통과');

function checkCode() {
  for (const file of walk(serverSrc)) {
    const text = readFileSync(file, 'utf8');
    const owner = moduleOf(file);
    for (const { spec, line } of imports(text)) checkImport(file, owner, spec, line);
    if (owner) checkSql(file, owner, text);
  }
  checkPlugins();
}

function checkPlugins() {
  const pluginsDir = join(root, 'plugins');
  const pluginApi = join(serverSrc, 'plugin-api');
  for (const name of readdirSync(pluginsDir)) {
    const dir = join(pluginsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8');
      for (const { spec, line } of imports(text)) {
        const where = `${relative(root, file)}:${line}`;
        const isServer = relative(dir, file).startsWith(`server${sep}`);
        if (!isServer && (spec === 'react' || spec.startsWith('react/'))) continue;
        if (isServer && spec.startsWith('node:')) continue;
        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          if (!relative(dir, target).startsWith('..')) continue;
          if (isServer && target === pluginApi) continue;
        }
        problems.push(
          `${where} 플러그인은 react와 자기 폴더 안의 파일만 가져올 수 있음: '${spec}'`,
        );
      }
    }
  }
}

function checkImport(file, owner, spec, line) {
  const where = `${relative(root, file)}:${line}`;
  if (spec.startsWith('.')) {
    const target = resolve(dirname(file), spec);
    const targetModule = moduleOf(target);
    if (!targetModule || targetModule === owner) return;
    const entry = join(modulesDir, targetModule);
    if (target !== entry && target !== join(entry, 'index')) {
      problems.push(
        `${where} ${targetModule} 모듈 내부를 직접 가져옴 → '${targetModule}' 모듈의 index.ts를 쓰세요`,
      );
    }
    if (owner && !map.modules[owner].dependsOn.includes(targetModule)) {
      problems.push(`${where} ${owner} → ${targetModule} 의존은 허용되지 않음 (modules.json)`);
    }
    return;
  }
  if (
    map.frameworkPackages.some((p) => spec === p || spec.startsWith(p.endsWith(':') ? p : `${p}/`))
  )
    return;
  if (owner && file.startsWith(join(modulesDir, map.libraryHome) + sep)) return;
  if (!owner) return; // main.api.ts 등 진입 파일
  problems.push(`${where} 외부 라이브러리 '${spec}'는 ${map.libraryHome} 안에서만 가져올 수 있음`);
}

function checkSql(file, owner, text) {
  const owned = map.modules[owner].schemas;
  for (const block of text.matchAll(/\b(?:sql|tx)`([\s\S]*?)`/g)) {
    // 따옴표 안의 글자(이벤트 이름 등)는 테이블이 아니므로 같은 길이의 빈칸으로 지운다
    const sqlText = block[1].replace(/'[^']*'/g, (q) => ' '.repeat(q.length));
    for (const ref of sqlText.matchAll(/\b([a-z_]+)\.([a-z_]+)\b/g)) {
      const schema = ref[1];
      if (!allSchemas.includes(schema) && schema !== 'app') continue;
      if (owned.includes(schema)) continue;
      const line = text.slice(0, block.index + ref.index).split('\n').length;
      problems.push(
        `${relative(root, file)}:${line} ${owner} 모듈이 다른 모듈의 테이블 ${ref[0]}에 SQL로 접근함`,
      );
    }
  }
}

function checkDatabase() {
  const mapping = Object.entries(map.modules)
    .flatMap(([m, def]) => def.schemas.map((s) => `('${s}','${m}')`))
    .join(',');
  const sql = `
    WITH m(schema, module) AS (VALUES ${mapping})
    SELECT 'fk|' || na.nspname || '.' || a.relname || '|' || c.conname || '|' || nb.nspname || '.' || b.relname
    FROM pg_constraint c
    JOIN pg_class a ON a.oid = c.conrelid JOIN pg_namespace na ON na.oid = a.relnamespace
    JOIN pg_class b ON b.oid = c.confrelid JOIN pg_namespace nb ON nb.oid = b.relnamespace
    LEFT JOIN m ma ON ma.schema = na.nspname LEFT JOIN m mb ON mb.schema = nb.nspname
    WHERE c.contype = 'f' AND ma.module IS DISTINCT FROM mb.module
    UNION ALL
    SELECT 'schema|' || nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'public')
      AND nspname NOT IN (SELECT schema FROM m);`;
  const out = execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'cairn', '-d', 'cairn', '-tA', '-c', sql],
    { cwd: root, encoding: 'utf8' },
  );
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [kind, a, b, c] = line.split('|');
    if (kind === 'fk') problems.push(`외래키 ${a}.${b} → ${c}: 모듈 사이 외래키는 두지 않음`);
    else problems.push(`스키마 ${a}: modules.json에 주인 모듈이 없음`);
  }
}

function moduleOf(path) {
  const rel = relative(modulesDir, path);
  if (rel.startsWith('..')) return null;
  const name = rel.split(sep)[0];
  return moduleNames.includes(name) ? name : null;
}

function* imports(text) {
  // import … from '…' · export … from '…' · import '…'
  const pattern = /(?:^|\n)\s*(?:(?:import|export)\s[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(pattern)) {
    yield { spec: m[1], line: text.slice(0, m.index + m[0].length).split('\n').length };
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(name)) yield path;
  }
}
