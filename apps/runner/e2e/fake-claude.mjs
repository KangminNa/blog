#!/usr/bin/env node
// 테스트용 가짜 Claude CLI. claude -p --output-format stream-json이 내는 줄을 그대로 흉내 낸다.
// 러너는 AI CLI에게 환경 변수를 거의 넘기지 않으므로, 무엇을 할지는 지시문 안의 표시로 정한다.
//   [fake:spy=<파일>]   받은 인자·환경·폴더를 파일에 적는다
//   [fake:hang]         끝나지 않는다
//   [fake:stubborn]     끝나지 않고 SIGTERM도 듣지 않는다
//   [fake:fail]         오류를 내고 코드 3으로 끝난다
//   [fake:error-result] 코드 0으로 끝나지만 결과가 실패다
//   [fake:approval]     작업 토큰으로 결재를 올린다 (MCP 설정 파일을 읽어서)
//   [fake:stray]        허락하지 않은 MCP 서버가 붙은 것처럼 보인다
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

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
