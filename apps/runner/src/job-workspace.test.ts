import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ClaudeCli } from './claude-cli';
import { Job } from './job';
import { JobWorkspace } from './job-workspace';
import { Json } from './json';

let skillsDir: string;

before(() => {
  skillsDir = mkdtempSync(join(tmpdir(), 'cairn-skills-'));
  const skill = join(skillsDir, 'cairn-write');
  mkdirSync(join(skill, 'references'), { recursive: true });
  mkdirSync(join(skill, 'agents', 'claude'), { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '# 글쓰기\n{{SKILL_DIR}}/references/style.md를 읽는다');
  writeFileSync(join(skill, 'references', 'style.md'), '문체');
  writeFileSync(join(skill, 'agents', 'claude', 'reviewer.md'), '검토자');
  writeFileSync(join(skill, '.secret'), '숨김');
  mkdirSync(join(skillsDir, 'not-a-skill'));
});

after(() => {
  rmSync(skillsDir, { recursive: true, force: true });
});

const open = (skill: string | null = null) =>
  JobWorkspace.open('{"mcpServers":{}}', '{"permissions":{}}', skill, skillsDir);

describe('일의 자리', () => {
  test('빈 폴더들과 600 권한의 MCP 설정을 만들고 지운다', async () => {
    const workspace = await open();
    assert.equal(statSync(workspace.mcpConfigPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(workspace.workDir, '..')).mode & 0o777, 0o700);
    assert.ok(!workspace.mcpConfigPath.startsWith(workspace.workDir));
    assert.equal(workspace.skillReady, false);
    await workspace.remove();
    assert.equal(existsSync(workspace.workDir), false);
    assert.equal(existsSync(workspace.mcpConfigPath), false);
  });

  test('스킬이 있으면 설정 폴더에 넣고 하위 에이전트와 숨김 파일은 뺀다', async () => {
    const workspace = await open('cairn-write');
    assert.equal(workspace.skillReady, true);
    const to = join(workspace.configDir, 'skills', 'cairn-write');
    assert.equal(
      readFileSync(join(to, 'SKILL.md'), 'utf8'),
      `# 글쓰기\n${to}/references/style.md를 읽는다`,
    );
    assert.equal(existsSync(join(to, 'references', 'style.md')), true);
    assert.equal(existsSync(join(to, 'agents')), false);
    assert.equal(existsSync(join(to, '.secret')), false);
    await workspace.remove();
  });

  test('스킬이 없거나 이름이 수상하면 스킬 없이 만든다', async () => {
    for (const skill of ['cairn-tidy', 'not-a-skill', '../cairn-write', '/etc', 'A B']) {
      const workspace = await open(skill);
      assert.equal(workspace.skillReady, false, skill);
      await workspace.remove();
    }
  });
});

describe('AI CLI 부르기', () => {
  const cli = new ClaudeCli('claude', 'oauth-token');

  test('MCP 설정에 작업 토큰과 cairn 서버 하나만 적는다', () => {
    const settings = JSON.parse(ClaudeCli.settings('/Users/owner/'));
    assert.deepEqual(settings.permissions.deny, [
      'Read(//Users/owner/**)',
      'Write(//Users/owner/**)',
      'Edit(//Users/owner/**)',
    ]);
    assert.deepEqual(JSON.parse(ClaudeCli.settings(undefined)).permissions.deny, []);
    const config = JSON.parse(ClaudeCli.mcpConfig('https://blog/mcp', 'run-token'));
    assert.deepEqual(config, {
      mcpServers: {
        cairn: {
          type: 'http',
          url: 'https://blog/mcp',
          headers: { Authorization: 'Bearer run-token' },
        },
      },
    });
  });

  test('셸을 주지 않고 cairn MCP만 허락한다', async () => {
    const workspace = await open();
    const args = [...cli.args(workspace)];
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Edit');
    assert.equal(args[args.indexOf('--allowedTools') + 1], 'mcp__cairn__*');
    assert.equal(args[args.indexOf('--mcp-config') + 1], workspace.mcpConfigPath);
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
    for (const banned of ['--bare', '--dangerously-skip-permissions', 'Bash'])
      assert.equal(args.join(' ').includes(banned), false, banned);
    await workspace.remove();
  });

  test('스킬이 있을 때만 Skill 도구를 준다', async () => {
    const workspace = await open('cairn-write');
    const args = [...cli.args(workspace)];
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Edit,Skill');
    assert.ok(args.includes('Skill'));
    await workspace.remove();
  });

  test('정해 둔 환경만 넘긴다', async () => {
    const workspace = await open();
    const env = cli.env(workspace, {
      PATH: '/bin',
      HOME: '/Users/me',
      CAIRN_RUNNER_TOKEN: 'device-token',
      ANTHROPIC_API_KEY: 'api-key',
      CLAUDE_CONFIG_DIR: '/Users/me/.claude',
    });
    assert.equal(env.PATH, '/bin');
    assert.equal(env.HOME, workspace.homeDir);
    assert.equal(env.CLAUDE_CONFIG_DIR, workspace.configDir);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-token');
    assert.equal(env.CAIRN_RUNNER_TOKEN, undefined);
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    await workspace.remove();
  });
});

describe('지시문', () => {
  const job = (more: object = {}) =>
    Job.from(
      Json.of({
        task: { id: 't', title: '초안 쓰기', lease_until: '2026-11-01T00:15:00.000Z' },
        instruction: '세션으로 글을 써 주세요',
        target: null,
        skill: null,
        revision_note: null,
        agent: { id: 'a', name: '글쓰기', role: '블로그 글을 쓴다', tool: 'claude' },
        run_token: 'run-token',
        ...more,
      }),
    );

  test('역할과 지시를 담는다. 작업 토큰은 담지 않는다', () => {
    const prompt = job().prompt(false);
    assert.ok(prompt.includes('글쓰기'));
    assert.ok(prompt.includes('블로그 글을 쓴다'));
    assert.ok(prompt.includes('세션으로 글을 써 주세요'));
    assert.equal(prompt.includes('run-token'), false);
    assert.equal(prompt.includes('# 대상'), false);
    assert.equal(prompt.includes('# 주인이'), false);
  });

  test('대상과 고쳐 달라는 말이 있으면 담는다', () => {
    const prompt = job({
      target: { kind: 'post', id: 'p1', version: 3 },
      revision_note: '더 짧게',
    }).prompt(false);
    assert.ok(prompt.includes('post p1, 판 3'));
    assert.ok(prompt.includes('더 짧게'));
  });

  test('스킬은 넣어 둔 때만 말한다', () => {
    const skilled = job({ skill: 'cairn-write' });
    assert.ok(skilled.prompt(true).includes('cairn-write'));
    assert.equal(skilled.prompt(false).includes('cairn-write'), false);
  });

  test('임대 끝을 시각으로 읽는다', () => {
    assert.equal(job().leaseUntil?.toISOString(), '2026-11-01T00:15:00.000Z');
  });
});
