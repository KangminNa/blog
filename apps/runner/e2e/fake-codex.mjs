#!/usr/bin/env node
// 테스트용 가짜 Codex CLI. 두 가지를 흉내 낸다 (화면 문구와 사건 모양은 실제 0.164.0의 것).
//   login --device-auth  주소와 한 번 쓰는 코드를 보이고, 사람이 넣을 시간을 두었다가 CODEX_HOME에 auth.json을 쓴다
//   exec --json …  -     지시문을 표준 입력으로 받아 사건을 JSONL로 낸다. 지시문 안의 표시로 할 일을 정한다:
//     [fake:spy=<파일>]  받은 인자 · 환경 · 설정 · 지시문을 파일에 적는다
//     [fake:rotate]      실행 중에 갱신 토큰이 바뀐 것처럼 auth.json을 바꾼다
//     [fake:approval]    작업 토큰(환경 변수)으로 cairn MCP에 결재를 올린다
//     [fake:shell]       셸 명령을 실행하려 한다 (셸을 꺼 두었으니 격리가 깨진 것)
//     [fake:fail]        턴이 실패하고 코드 1로 끝난다
//     [fake:leak]        auth.json의 갱신 토큰을 답에 섞는다 (러너가 지우는지)
//     [fake:hang]        끝나지 않는다
// 러너가 넘긴 환경을 본다: 빈 CODEX_HOME, 셸을 끈 설정, 다른 인증 값 · 기기 토큰 없음.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv[2] === 'exec') await exec();

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

/** codex exec --json: 사건을 한 줄씩 낸다 */
async function exec() {
  const prompt = await new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
  });
  const has = (name) => prompt.includes(`[fake:${name}]`);
  const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  const home = process.env.CODEX_HOME ?? '';
  const config = readFileSync(join(home, 'config.toml'), 'utf8');
  const authPath = join(home, 'auth.json');
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  const leaks = ['OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CAIRN_RUNNER_TOKEN', 'DATABASE_URL'];
  const isolated =
    config.includes('shell_tool = false') &&
    config.includes('unified_exec = false') &&
    config.includes('network_access = false') &&
    process.argv.includes('--strict-config') &&
    !leaks.some((name) => process.env[name]);
  if (!isolated) {
    say({ type: 'error', message: 'fake: 격리가 깨졌다' });
    process.exit(9);
  }

  const spy = /\[fake:spy=([^\]]+)\]/.exec(prompt)?.[1];
  if (spy)
    writeFileSync(
      spy,
      JSON.stringify({
        argv: process.argv.slice(2),
        env: process.env,
        config,
        prompt,
        cwd: process.cwd(),
      }),
    );

  say({ type: 'thread.started', thread_id: randomUUID() });
  say({ type: 'turn.started' });
  if (has('rotate')) {
    auth.tokens = { ...auth.tokens, refresh_token: `rotated-${randomUUID()}` };
    writeFileSync(authPath, JSON.stringify(auth, null, 2));
  }
  if (has('shell')) {
    say({
      type: 'item.started',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: 'cat ~/.ssh/id_rsa',
        status: 'in_progress',
      },
    });
  }
  if (has('hang') || has('shell')) await new Promise(() => setInterval(() => {}, 1000));
  if (has('approval')) {
    const url = /url = "([^"]+)"/.exec(config)?.[1];
    say({
      type: 'item.started',
      item: {
        id: 'item_1',
        type: 'mcp_tool_call',
        server: 'cairn',
        tool: 'request_approval',
        arguments: {},
        status: 'in_progress',
      },
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${process.env.CAIRN_RUN_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'request_approval',
          arguments: {
            request_id: randomUUID(),
            action: 'blog.post.publish',
            target_kind: 'post',
            target_id: randomUUID(),
            target_version: 1,
            note: 'Codex가 올린 결재',
          },
        },
      }),
    });
    const body = await res.json();
    if (res.status !== 200 || body.result?.isError) {
      say({
        type: 'turn.failed',
        error: { message: `결재를 올리지 못했어요: ${JSON.stringify(body)}` },
      });
      process.exit(4);
    }
  }
  if (has('fail')) {
    say({ type: 'turn.failed', error: { message: 'fake: 턴 실패' } });
    process.exit(1);
  }
  const leak = has('leak') ? ` ${auth.tokens?.refresh_token}` : '';
  say({
    type: 'item.completed',
    item: { id: 'item_2', type: 'agent_message', text: `codex 끝${leak}` },
  });
  say({
    type: 'turn.completed',
    usage: { input_tokens: 300, cached_input_tokens: 100, output_tokens: 20 },
  });
  process.exit(0);
}
