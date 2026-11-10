// 테스트: 개발 DB와 섞이지 않게 테스트 전용 DB(cairn_test)를 매번 새로 만들고, 마이그레이션한 뒤
// 서버·플러그인 테스트(단위 + API)를 돌린다. Docker의 db만 있으면 된다.
// 연결 명령(packages/cli) 테스트는 DB가 필요 없어 이 컴퓨터에서 바로 돌린다. 러너는 단위 테스트와, 전용 DB로 실제 서버와 붙는 통합 테스트까지.
//
//   pnpm test                   전부
//   pnpm test -- --test-name-pattern=플러그인   이름으로 골라서
//   pnpm slot 2 test            슬롯 2에서 (작업 트리는 슬롯으로만)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');

// 작업 트리에서는 .git이 파일이다. 슬롯 없이 돌리면 본 저장소의 개발 환경과 DB를 함께 쓰게 된다
if (statSync(join(root, '.git')).isFile() && !process.env.CAIRN_SLOT) {
  console.error('작업 트리에서는 pnpm slot <번호> test로 돌려 주세요');
  process.exit(1);
}

const password = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD') ?? 'cairn';
const testDb = `postgres://cairn:${password}@cairn-db:5432/cairn_test?sslmode=disable`;
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
// 코어와 기능 패키지의 마이그레이션 (compose의 migrate가 plugins/*/migrations까지 넘긴다)
docker(['run', '--rm', '-e', `DATABASE_URL=${testDb}`, 'migrate']);
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
execFileSync('pnpm', ['--filter', '@cairn/egress', 'test', ...extra], {
  cwd: root,
  stdio: 'inherit',
});
for (const script of ['test', 'test:e2e'])
  execFileSync('pnpm', ['--filter', '@cairn/runner', script, ...extra], {
    cwd: root,
    stdio: 'inherit',
  });

function fromEnvFile(key) {
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : null;
}
