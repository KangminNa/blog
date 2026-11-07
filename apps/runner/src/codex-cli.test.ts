import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { CodexCli } from './codex-cli';
import { Job } from './job';
import { Json } from './json';

// Codex 어댑터: 작업마다 만드는 CODEX_HOME, 셸을 끈 설정, 넘기는 환경, 갱신된 자격 찾기.

const AUTH = JSON.stringify({
  OPENAI_API_KEY: null,
  tokens: {
    access_token: 'access-token-123456789',
    refresh_token: 'refresh-token-123456789',
    account_id: 'acct',
  },
});

let skills: string;

const job = (more: object = {}): Job =>
  Job.from(
    Json.of({
      task: { id: 'task-1', kind: 'draft_post', title: '초안', payload: {} },
      instruction: '글을 써 주세요',
      agent: { name: '글쓰기', role: '', tool: 'codex' },
      run_token: 'run-token-secret',
      skill: 'cairn-write',
      ...more,
    }),
  );

before(async () => {
  skills = await mkdtemp(join(tmpdir(), 'codex-skills-'));
  await rm(join(skills, 'cairn-write'), { recursive: true, force: true });
  await writeFile(join(skills, 'README'), '');
  const dir = join(skills, 'cairn-write');
  await (await import('node:fs/promises')).mkdir(dir);
  await writeFile(
    join(dir, 'SKILL.md'),
    '---\nname: cairn-write\n---\n초안은 blog_save_draft로 저장한다.\n',
  );
});

after(async () => {
  await rm(skills, { recursive: true, force: true });
});

describe('Codex 설정', () => {
  test('셸을 끄고, 네트워크 없이 작업 폴더만 쓰고, MCP는 cairn 하나에 토큰은 환경 변수로', () => {
    const toml = CodexCli.configToml('http://127.0.0.1:4000/mcp');
    for (const want of [
      'shell_tool = false',
      'unified_exec = false',
      'network_access = false',
      'sandbox_mode = "workspace-write"',
      'approval_policy = "never"',
      'web_search = "disabled"',
      'inherit = "core"',
      '[mcp_servers.cairn]',
      'url = "http://127.0.0.1:4000/mcp"',
      'bearer_token_env_var = "CAIRN_RUN_TOKEN"',
    ])
      assert.ok(toml.includes(want), want);
    assert.equal(toml.includes('run-token'), false, '토큰은 파일에 쓰지 않는다');
    assert.equal(CodexCli.configToml(null).includes('mcp_servers'), false, '연결 확인은 MCP 없이');
  });

  test('작업 자리: config/에 config.toml과 auth.json(600), Claude의 settings.json은 없다', async () => {
    const cli = new CodexCli('codex', AUTH, 'http://127.0.0.1:4000/mcp', skills);
    const workspace = await cli.open(job());
    try {
      assert.deepEqual((await readdir(workspace.configDir)).sort(), ['auth.json', 'config.toml']);
      assert.equal(statSync(join(workspace.configDir, 'auth.json')).mode & 0o777, 0o600);
      assert.equal(await readFile(join(workspace.configDir, 'auth.json'), 'utf8'), AUTH);
      assert.equal(await cli.changedCredential(workspace), null, '바뀌지 않았으면 null');
      const rotated = AUTH.replace('refresh-token-123456789', 'refresh-token-ROTATED-0001');
      await writeFile(join(workspace.configDir, 'auth.json'), rotated);
      assert.equal(await cli.changedCredential(workspace), rotated);
    } finally {
      await workspace.remove();
    }
  });

  test('넘기는 환경: CODEX_HOME과 빈 홈, 작업 토큰. 기기 토큰과 다른 키는 넘기지 않는다', async () => {
    const cli = new CodexCli('codex', AUTH, 'http://x/mcp', skills);
    const workspace = await cli.open(job());
    try {
      const env = cli.env(job(), workspace, {
        PATH: '/usr/bin',
        CAIRN_RUNNER_TOKEN: 'device-secret',
        OPENAI_API_KEY: 'sk-other',
        HOME: '/home/owner',
      });
      assert.equal(env.CODEX_HOME, workspace.configDir);
      assert.equal(env.HOME, workspace.homeDir);
      assert.equal(env.CAIRN_RUN_TOKEN, 'run-token-secret');
      assert.equal(env.PATH, '/usr/bin');
      assert.equal('CAIRN_RUNNER_TOKEN' in env, false);
      assert.equal('OPENAI_API_KEY' in env, false);
      assert.deepEqual(cli.args(workspace).slice(0, 3), ['exec', '--json', '--strict-config']);
      assert.equal(cli.args(workspace).at(-1), '-', '지시문은 표준 입력으로');
    } finally {
      await workspace.remove();
    }
  });

  test('스킬은 셸 없이 읽을 수 없어 지시문에 넣는다', () => {
    const prompt = job().prompt(false, '초안은 blog_save_draft로 저장한다.');
    assert.match(prompt, /# 스킬: cairn-write/);
    assert.match(prompt, /blog_save_draft로 저장한다/);
  });

  test('auth.json 안의 토큰은 로그에서 지울 값이다', () => {
    const cli = new CodexCli('codex', AUTH, 'http://x/mcp', skills);
    assert.deepEqual([...cli.secrets].sort(), [
      'access-token-123456789',
      'refresh-token-123456789',
    ]);
  });
});
