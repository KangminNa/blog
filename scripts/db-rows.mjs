// 표마다 인터페이스 하나와 Drizzle 표 하나를 만든다. 칼럼의 원본은 마이그레이션이고, 코드는 이 파일들로 표를 안다.
// 모듈마다 modules/<모듈>/<모듈>.tables.ts(행 타입, 웹도 가져옴)와 <모듈>.schema.ts(조건 규칙이 쓰는 Drizzle 표).
// 기능 패키지(plugins/<이름>/, 목록 파일에 schema가 있는 것)는 plugins/<이름>/server/tables.ts · schema.ts.
// 마이그레이션 뒤 다시 만든다. Docker의 db가 떠 있어야 함.
//
//   node scripts/db-rows.mjs           파일을 다시 쓴다
//   node scripts/db-rows.mjs --check   DB와 파일이 다르면 실패
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { rowTypeOf } from './table-name.mjs';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const map = JSON.parse(readFileSync(join(root, 'apps/server/modules.json'), 'utf8'));

const TS_TYPES = {
  bool: 'boolean',
  bytea: 'Buffer',
  float4: 'number',
  float8: 'number',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  jsonb: 'unknown',
  timestamptz: 'Date',
};

/** Drizzle 칸 만드는 함수 (pg-core). 여기 없는 타입은 파일 안에서 customType으로 만든다 */
const DRIZZLE = {
  bool: (c) => `boolean('${c}')`,
  float4: (c) => `real('${c}')`,
  float8: (c) => `doublePrecision('${c}')`,
  inet: (c) => `inet('${c}')`,
  int2: (c) => `smallint('${c}')`,
  int4: (c) => `integer('${c}')`,
  int8: (c) => `bigint('${c}', { mode: 'number' })`,
  jsonb: (c) => `jsonb('${c}')`,
  text: (c) => `text('${c}')`,
  timestamptz: (c) => `timestamp('${c}', { withTimezone: true })`,
  uuid: (c) => `uuid('${c}')`,
};

/** 기능 패키지: 이름 → 자기 스키마 (목록 파일 schema) */
const pluginsDir = join(root, 'plugins');
const packages = existsSync(pluginsDir)
  ? readdirSync(pluginsDir).flatMap((name) => {
      const file = join(pluginsDir, name, 'cairn-plugin.json');
      if (!existsSync(file)) return [];
      const schema = JSON.parse(readFileSync(file, 'utf8')).schema;
      return typeof schema === 'string' ? [[name, schema]] : [];
    })
  : [];

const schemas = [
  ...Object.values(map.modules).flatMap((m) => m.schemas),
  ...packages.map(([, schema]) => schema),
];
const columns = readColumns(schemas);
const stale = [];

const targets = [
  ...Object.entries(map.modules).map(([module, { schemas: owned }]) => {
    const dir = join(root, 'apps/server/src/modules', module);
    return [owned, join(dir, `${module}.tables.ts`), join(dir, `${module}.schema.ts`)];
  }),
  ...packages.map(([name, schema]) => {
    const dir = join(pluginsDir, name, 'server');
    return [
      [schema],
      join(dir, 'tables.ts'),
      join(dir, 'schema.ts'),
      '../../../apps/server/src/plugin-api',
    ];
  }),
];
for (const [owned, tablesFile, schemaFile, pluginApi] of targets) {
  const mine = columns.filter((c) => owned.includes(c.schema));
  for (const [file, text] of [
    [tablesFile, render(mine)],
    [schemaFile, renderSchema(mine, pluginApi)],
  ]) {
    if (process.argv.includes('--check')) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== text) stale.push(file);
    } else writeFileSync(file, text);
  }
}

if (stale.length > 0) {
  console.error('표 인터페이스나 Drizzle 표가 DB와 달라요. pnpm db:rows로 다시 만들어 주세요:');
  for (const file of stale) console.error(`  ${relative(root, file)}`);
  process.exit(1);
}

function readColumns(names) {
  const list = names.map((s) => `'${s}'`).join(',');
  const sql = `
    SELECT coalesce(json_agg(c ORDER BY c.schema, c.name, c.position), '[]')
    FROM (
      SELECT col.table_schema AS schema, col.table_name AS name, col.ordinal_position AS position,
        col.column_name AS column, col.udt_name AS type, col.is_nullable = 'YES' AS nullable,
        col.column_default IS NOT NULL OR col.is_identity = 'YES' OR col.is_generated = 'ALWAYS' AS filled
      FROM information_schema.columns col
      JOIN information_schema.tables t
        ON t.table_schema = col.table_schema AND t.table_name = col.table_name
      WHERE col.table_schema IN (${list}) AND t.table_type = 'BASE TABLE'
    ) c`;
  const out = execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'cairn', '-d', 'cairn', '-tA', '-c', sql],
    { cwd: root, encoding: 'utf8' },
  );
  return JSON.parse(out);
}

function render(found) {
  const tables = Map.groupBy(found, (c) => `${c.schema}.${c.name}`);
  const blocks = [...tables].map(([name, cols]) => renderTable(name, cols));
  return [
    '// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).',
    '// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.',
    '// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.',
    '',
    blocks.join('\n'),
  ].join('\n');
}

function renderTable(name, cols) {
  const base = rowTypeOf(name.split('.')[1]);
  const fields = cols.map((c) => `  ${c.column}: ${tsType(c)};`);
  const required = cols.filter((c) => c.column === 'id' || (!c.nullable && !c.filled));
  const keys = required.map((c) => `'${c.column}'`).join(' | ') || 'never';
  return [
    `/** ${name} */`,
    `export interface ${base}Row {`,
    ...fields,
    '}',
    `export type ${base}New = Partial<${base}Row> & Pick<${base}Row, ${keys}>;`,
    '',
  ].join('\n');
}

function tsType({ type, nullable }) {
  const value = type.startsWith('_')
    ? `readonly ${TS_TYPES[type.slice(1)] ?? 'string'}[]`
    : (TS_TYPES[type] ?? 'string');
  return nullable ? `${value} | null` : value;
}

/** 쿼리 템플릿이 쓰는 Drizzle 표. 칸 이름(객체의 열쇠)은 DB 그대로라 고른 행이 <모듈>.tables.ts의 행과 같다 */
/** pluginApi: 기능 패키지면 plugin-api 경로 (drizzle-orm 대신 TableColumns로 가져온다) */
function renderSchema(found, pluginApi) {
  const tables = Map.groupBy(found, (c) => `${c.schema}.${c.name}`);
  const builders = new Set(['pgSchema']);
  const custom = new Map();
  const columnOf = (c) => {
    const base = c.type.startsWith('_') ? c.type.slice(1) : c.type;
    let made;
    if (DRIZZLE[base]) {
      made = DRIZZLE[base](c.column);
      builders.add(made.slice(0, made.indexOf('(')));
    } else {
      builders.add('customType');
      custom.set(base, TS_TYPES[base] ?? 'string');
      made = `${base}Column('${c.column}')`;
    }
    if (c.type.startsWith('_')) made += '.array()';
    if (!c.nullable) made += '.notNull()';
    return `  ${c.column}: ${made},`;
  };
  const owned = [...new Set(found.map((c) => c.schema))];
  const blocks = [...tables].map(([name, cols]) => {
    const [schema, table] = name.split('.');
    return [
      `/** ${name} */`,
      `export const ${camel(table)} = ${camel(schema)}Schema.table('${table}', {`,
      ...cols.map(columnOf),
      '});',
      '',
    ].join('\n');
  });
  return [
    '// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).',
    '// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.',
    '// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).',
    pluginApi
      ? `import { TableColumns } from '${pluginApi}';\n\nconst { ${[...builders].sort().join(', ')} } = TableColumns;`
      : `import { ${[...builders].sort().join(', ')} } from 'drizzle-orm/pg-core';`,
    '',
    ...[...custom].map(
      ([type, ts]) =>
        `const ${type}Column = customType<{ data: ${ts} }>({ dataType: () => '${type}' });`,
    ),
    ...owned.map((schema) => `const ${camel(schema)}Schema = pgSchema('${schema}');`),
    '',
    blocks.join('\n'),
  ].join('\n');
}

/** ai_logins → aiLogins */
function camel(name) {
  return name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
