// 병렬 작업용 슬롯. 슬롯마다 compose 프로젝트·포트·이미지 태그가 달라 DB와 컨테이너가 섞이지 않는다.
// 작업 트리(worktree)에서는 개발 DB를 건드리지 않도록 반드시 슬롯으로 돌린다.
//
//   pnpm slot 2 test           슬롯 2에서 테스트
//   pnpm slot 2 dev            슬롯 2의 개발 환경 (웹 3200 · 서버 4200 · DB 5632)
//   pnpm slot 2 dev:down       슬롯 2 내리기
//   pnpm slot 2 db:reset       슬롯 2의 DB만 지우고 다시 만들기
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [slot, script, ...args] = process.argv.slice(2);
if (!/^[1-9]$/.test(slot ?? '') || !script) {
  console.error('사용법: pnpm slot <1~9> <스크립트> [인자]');
  process.exit(1);
}
const n = Number(slot);
const webPort = 3000 + n * 100;
const env = {
  ...process.env,
  CAIRN_SLOT: slot,
  COMPOSE_PROJECT_NAME: `cairn-s${slot}`,
  CAIRN_IMAGE_TAG: `s${slot}`,
  DB_PORT: String(5432 + n * 100),
  SERVER_PORT: String(4000 + n * 100),
  WEB_PORT: String(webPort),
  CAIRN_WEB_URL: `http://localhost:${webPort}`,
  // 작업 트리에는 .env가 없다. 슬롯 DB에만 쓰는 값이라 비밀이 아니다
  CAIRN_SECRET_KEY:
    process.env.CAIRN_SECRET_KEY ??
    createHash('sha256').update(`cairn-slot-${slot}`).digest('base64'),
};
const result = spawnSync('pnpm', ['--silent', script, ...args], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
