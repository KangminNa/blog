#!/usr/bin/env node
// 테스트용 가짜 Claude CLI. claude -p --output-format stream-json이 내는 줄을 그대로 흉내 낸다.
// 러너는 AI CLI에게 환경 변수를 거의 넘기지 않으므로, 무엇을 할지는 지시문 안의 표시로 정한다.
//   [fake:spy=<파일>]   받은 인자·환경·폴더를 파일에 적는다
//   [fake:hang]         끝나지 않는다
//   [fake:stubborn]     끝나지 않고 SIGTERM도 듣지 않는다
//   [fake:fail]         오류를 내고 코드 3으로 끝난다
//   [fake:error-result] 코드 0으로 끝나지만 결과가 실패다
//   [fake:approval]     작업 토큰으로 결재를 올린다 (MCP 설정 파일을 읽어서)
//   [fake:delegate]     지시문의 "내 팀"에게 하위 작업을 하나씩 맡기고 끝난다. 결과를 받아 깨어난 실행은 맡기지 않고 끝낸다
//   [fake:stray]        허락하지 않은 MCP 서버가 붙은 것처럼 보인다
// 연결 확인(MCP 설정 없음)은 ok라고 답한다. 토큰에 wrong이 들어 있으면 로그인 실패처럼 끝난다
// setup-token은 웹 로그인이다: 터미널이어야 뜨고, 주소를 보이고, 붙여 넣은 코드로 토큰을 그린다.
//   코드에 wrong이 있으면 실패. 코드와 Enter가 한 덩어리로 오면 Ink처럼 붙여 넣기로 보고 제출하지 않는다
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

if (process.argv[2] === 'setup-token') await setupToken();

/** claude setup-token의 화면 (색, 하이퍼링크). 화면의 문구는 실제 CLI의 것 */
async function setupToken() {
  const esc = '\x1b';
  const leaks = [
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'CAIRN_RUNNER_TOKEN',
    'DATABASE_URL',
  ];
  const config = process.env.CLAUDE_CONFIG_DIR;
  if (!process.stdin.isTTY) {
    process.stderr.write('Error: Raw mode is not supported on the current process.stdin\n');
    process.exit(1);
  }
  const broken =
    leaks.some((name) => process.env[name]) ||
    !config ||
    readdirSync(config).length > 0 ||
    process.env.BROWSER !== 'true' ||
    process.stdout.columns < 500;
  if (broken) {
    process.stdout.write('fake: 격리가 깨졌다\n');
    process.exit(9);
  }
  const url =
    'https://claude.ai/oauth/authorize?code=true&client_id=fake&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=fake&code_challenge_method=S256&state=fake';
  process.stdout.write(
    `${esc}[36mBrowser didn't open? Use the url below to sign in (c to copy)${esc}[39m\n\n` +
      `${esc}]8;;${url}\x07${url}${esc}]8;;\x07\n\nPaste code here if prompted > `,
  );
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  let code = '';
  for await (const chunk of process.stdin) {
    if (chunk === '\r') break;
    code += chunk.replaceAll('\r', '');
    process.stdout.write(chunk.replaceAll('\r', ''));
  }
  process.stdout.write('\n');
  if (code.includes('wrong')) {
    process.stdout.write('OAuth error: Invalid code\n');
    process.exit(1);
  }
  const token = `sk-ant-oat01-fake_${code.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  process.stdout.write(
    `${esc}[32m✓ Long-lived authentication token created successfully!${esc}[39m\n\n` +
      `Your OAuth token (valid for 1 year):\n\n${token}\n\n` +
      "Store this token securely. You won't be able to see it again.\n\n" +
      'Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>\n',
  );
  process.exit(0);
}

const prompt = await new Promise((resolve) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    text += chunk;
  });
  process.stdin.on('end', () => resolve(text));
});

const has = (name) => prompt.includes(`[fake:${name}]`);
const session_id = randomUUID();
const say = (line) => process.stdout.write(`${JSON.stringify({ ...line, session_id })}\n`);
const assistant = (id, usage, ...content) =>
  say({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { id, type: 'message', role: 'assistant', model: 'fake', content, usage },
  });
const toolResult = (tool_use_id, content, is_error = false) =>
  say({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id, content, is_error }] },
  });
const forever = () => new Promise(() => setInterval(() => {}, 1000));

// 연결 확인은 MCP 설정 없이 뜬다. 지시문이 서버의 고정된 글이라 표시를 넣을 수 없어서 토큰으로 정한다
if (!process.argv.includes('--mcp-config')) {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
  say({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    model: 'fake',
    apiKeySource: 'none',
    tools: [],
    mcp_servers: [],
  });
  if (token.includes('wrong')) {
    say({ type: 'result', subtype: 'success', is_error: true, result: `틀린 토큰 ${token}` });
    process.exit(1);
  }
  assistant('msg_1', { input_tokens: 5, output_tokens: 1 }, { type: 'text', text: 'ok' });
  say({ type: 'result', subtype: 'success', is_error: false, result: 'ok' });
  process.exit(0);
}

const mcpConfigPath = process.argv[process.argv.indexOf('--mcp-config') + 1];
const cairn = JSON.parse(readFileSync(mcpConfigPath, 'utf8')).mcpServers.cairn;

const spy = /\[fake:spy=([^\]]+)\]/.exec(prompt)?.[1];
if (spy) {
  writeFileSync(
    spy,
    JSON.stringify({
      pid: process.pid,
      argv: process.argv.slice(2),
      env: process.env,
      cwd: process.cwd(),
      cwdEntries: readdirSync(process.cwd()),
      configEntries: readdirSync(process.env.CLAUDE_CONFIG_DIR),
      mcpConfigPath,
      mcpConfigMode: statSync(mcpConfigPath).mode & 0o777,
      mcpUrl: cairn.url,
      runToken: cairn.headers.Authorization.replace('Bearer ', ''),
      prompt,
    }),
  );
}

// 실제 실행에서 받은 줄 그대로 (2026-11-01). 초기화 시각만 지금 기준으로 둔다: 고정하면 시각이 지난 뒤 테스트가 깨진다
const inHours = (hours) => Math.floor(Date.now() / 1000) + hours * 3600;
const rateLimit = () =>
  say({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: inHours(3),
      rateLimitType: 'five_hour',
      overageStatus: 'rejected',
      overageDisabledReason: 'org_level_disabled',
      isUsingOverage: false,
      unifiedWindows: {
        five_hour: { utilization: 0.72, resetsAt: inHours(3) },
        seven_day: { utilization: 0.19, resetsAt: inHours(100) },
      },
    },
  });

const servers = [{ name: 'cairn', status: 'connected' }];
if (has('stray')) servers.push({ name: 'claude.ai Gmail', status: 'connected' });
say({
  type: 'system',
  subtype: 'init',
  cwd: process.cwd(),
  model: 'fake',
  permissionMode: 'acceptEdits',
  apiKeySource: 'none',
  tools: ['Read', 'Write', 'Edit', 'mcp__cairn__request_approval'],
  mcp_servers: servers,
});
if (has('stray')) await forever();

// 메시지 하나가 블록마다 한 줄씩 나온다. usage는 같은 값이 반복된다
const first = {
  input_tokens: 100,
  cache_creation_input_tokens: 10,
  cache_read_input_tokens: 500,
  output_tokens: 20,
};
rateLimit();
assistant('msg_1', first, { type: 'text', text: '자료부터 읽을게요' });
assistant('msg_1', first, {
  type: 'tool_use',
  id: 'toolu_1',
  name: 'Read',
  input: { file_path: 'notes.md' },
});
toolResult('toolu_1', '메모 내용');

assistant(
  'msg_2',
  { input_tokens: 200, output_tokens: 30 },
  {
    type: 'tool_use',
    id: 'toolu_2',
    name: 'mcp__cairn__blog_save_draft',
    input: { title: '초안', body: '본문은 기록에 남기지 않는다' },
  },
);
toolResult('toolu_2', `토큰 ${process.env.CLAUDE_CODE_OAUTH_TOKEN} 때문에 실패`, true);

/** 작업 토큰으로 cairn 도구 하나를 부른다. 실패하면 코드 4로 끝난다 */
async function callTool(name, args) {
  const res = await fetch(cairn.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...cairn.headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = await res.json();
  if (res.status !== 200 || body.result?.isError) {
    process.stderr.write(`${name}을(를) 부르지 못했어요: ${JSON.stringify(body)}\n`);
    process.exit(4);
  }
  return body.result.structuredContent;
}

if (has('delegate') && !prompt.includes('# 맡긴 하위 작업의 결과')) {
  const team = [...prompt.matchAll(/^- (.+?) \(agent_id: ([0-9a-f-]+)\)/gm)];
  await callTool('delegate_task', {
    subtasks: team.map(([, name, id]) => ({
      request_id: randomUUID(),
      to_agent_id: id,
      title: `${name}에게 맡긴 조사`,
      instruction: '자료를 모아 주세요',
    })),
  });
}

if (has('approval')) {
  const res = await fetch(cairn.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...cairn.headers,
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
          target_version: 3,
          note: '공개해 주세요',
        },
      },
    }),
  });
  const body = await res.json();
  if (res.status !== 200 || body.result?.isError) {
    process.stderr.write(`결재를 올리지 못했어요: ${JSON.stringify(body)}\n`);
    process.exit(4);
  }
}

if (has('stubborn')) process.on('SIGTERM', () => {});
if (has('hang') || has('stubborn')) await forever();

if (has('fail')) {
  process.stderr.write('치명적 오류: 모델에 닿지 못했어요\n');
  process.exit(3);
}

if (has('error-result')) {
  say({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['턴 수를 넘겼어요'] });
  process.exit(0);
}

const text = '초안을 저장했어요';
assistant('msg_3', { input_tokens: 50, output_tokens: 10 }, { type: 'text', text });
say({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 1200,
  num_turns: 3,
  result: text,
  total_cost_usd: 0.01,
  usage: { input_tokens: 350, cache_creation_input_tokens: 10, output_tokens: 60 },
  // 본 줄에 없던 토큰(하위 에이전트 몫)까지 든 합계. 앞에서 센 420에 7이 더해진다
  modelUsage: {
    fake: {
      inputTokens: 350,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 500,
      outputTokens: 67,
      costUSD: 0.01,
    },
  },
});
