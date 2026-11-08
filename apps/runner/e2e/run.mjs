// 러너 통합 테스트: 실제 서버(AppModule)와 러너 프로세스, 가짜 AI CLI를 함께 돌린다.
// 서버 테스트처럼 앱 이미지 안에서, 개발 DB와 섞이지 않게 전용 DB(cairn_runner_test)를 새로 만들어 돌린다.
//
//   pnpm slot 1 runner test:e2e                                    전부
//   pnpm slot 1 runner test:e2e --test-name-pattern=취소            이름으로 골라서
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// 작업 트리에서는 .git이 파일이다. 슬롯 없이 돌리면 본 저장소의 개발 환경과 DB를 함께 쓰게 된다
if (statSync(join(root, '.git')).isFile() && !process.env.CAIRN_SLOT) {
  console.error('작업 트리에서는 pnpm slot <번호> runner test:e2e로 돌려 주세요');
  process.exit(1);
}

const password = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD') ?? 'cairn';
const testDb = `postgres://cairn:${password}@cairn-db:5432/cairn_runner_test?sslmode=disable`;
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
  'DROP DATABASE IF EXISTS cairn_runner_test',
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
  'exec',
  'node',
  '--test',
  '--test-concurrency=1',
  '--test-timeout=300000',
  '--test-force-exit',
  '-r',
  '@swc-node/register',
  ...extra,
  '../runner/e2e/runner.e2e.test.ts',
]);

function fromEnvFile(key) {
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : null;
}
