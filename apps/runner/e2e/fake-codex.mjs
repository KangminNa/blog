#!/usr/bin/env node
// 테스트용 가짜 Codex CLI. codex login --device-auth의 화면만 흉내 낸다 (문구는 실제 CLI의 것).
// 주소와 한 번 쓰는 코드를 보이고, 사람이 코드를 넣을 시간을 두었다가 CODEX_HOME에 auth.json을 쓰고 끝난다.
// 러너가 넘긴 환경을 본다: 빈 CODEX_HOME(파일 저장 설정만), 브라우저를 열지 않음, 다른 인증 값 없음.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 러너가 2초마다 화면을 보므로 그보다 넉넉히 둔다 */
const APPROVE_MS = 6_000;
const esc = '\x1b';

const [command, flag] = process.argv.slice(2);
if (command !== 'login' || flag !== '--device-auth') {
  process.stderr.write('fake-codex: login --device-auth만 안다\n');
  process.exit(2);
}
const home = process.env.CODEX_HOME;
const leaks = ['OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CAIRN_RUNNER_TOKEN', 'DATABASE_URL'];
const config = home ? readFileSync(join(home, 'config.toml'), 'utf8') : '';
const broken =
  !home ||
  leaks.some((name) => process.env[name]) ||
  !config.includes('cli_auth_credentials_store = "file"') ||
  readdirSync(home).length !== 1 ||
  process.env.BROWSER !== 'true';
if (broken) {
  process.stdout.write('fake: 격리가 깨졌다\n');
  process.exit(9);
}

process.stdout.write(
  'Welcome to Codex [v0.164.0]\n' +
    "OpenAI's command-line coding agent\n\n" +
    'Follow these steps to sign in with ChatGPT using device code authorization:\n\n' +
    `1. Open this link in your browser and sign in to your account\n   ${esc}[94mhttps://auth.openai.com/codex/device${esc}[0m\n\n` +
    `2. Enter this one-time code ${esc}[90m(expires in 15 minutes)${esc}[0m\n   ${esc}[94mFAKE-C0DE1${esc}[0m\n\n` +
    `${esc}[90mDevice codes are a common phishing target. Never share this code.${esc}[0m\n`,
);
await new Promise((done) => setTimeout(done, APPROVE_MS));
const auth = {
  OPENAI_API_KEY: null,
  tokens: {
    id_token: 'fake-id',
    access_token: 'fake-access',
    refresh_token: 'fake-refresh',
    account_id: 'fake-account',
  },
  last_refresh: new Date().toISOString(),
};
writeFileSync(join(home, 'auth.json'), JSON.stringify(auth, null, 2), { mode: 0o600 });
process.stdout.write('Successfully logged in\n');
process.exit(0);
