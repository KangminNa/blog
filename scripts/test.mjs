// 테스트: 개발 DB와 섞이지 않게 테스트 전용 DB(cairn_test)를 매번 새로 만들고, 마이그레이션한 뒤
// 서버·플러그인 테스트(단위 + API)를 돌린다. Docker의 db만 있으면 된다.
// 연결 명령(packages/cli) 테스트는 DB가 필요 없어 이 컴퓨터에서 바로 돌린다.
//
//   pnpm test                   전부
//   pnpm test -- --test-name-pattern=플러그인   이름으로 골라서
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const password = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD') ?? 'cairn';
const testDb = `postgres://cairn:${password}@db:5432/cairn_test?sslmode=disable`;
const extra = process.argv.slice(2).filter((a) => a !== '--');

const docker = (args) =>
  execFileSync('docker', ['compose', ...args], { cwd: root, stdio: 'inherit' });

docker(['up', '-d', '--wait', 'db']);
docker([
  'exec',
  '-T',
  'db',
  'psql',
  '-q',
  '-U',
  'cairn',
  '-d',
  'postgres',
  '-c',
  'DROP DATABASE IF EXISTS cairn_test',
]);
docker([
  'run',
  '--rm',
  '-e',
  `DATABASE_URL=${testDb}`,
  'migrate',
  '--wait',
  '--no-dump-schema',
  '--migrations-dir',
  '/db/migrations',
  'up',
]);
docker([
  'run',
  '--rm',
  '--build',
  '--no-deps',
  '-e',
  `DATABASE_URL=${testDb}`,
  'server',
  'pnpm',
  '--filter',
  '@cairn/server',
  'test',
  ...extra,
]);
execFileSync('pnpm', ['--filter', '@cairn/cli', 'test', ...extra], { cwd: root, stdio: 'inherit' });

function fromEnvFile(key) {
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : null;
}
