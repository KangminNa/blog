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
import { AgentUser } from './agent-user';
import { ClaudeCli } from './claude-cli';
import { Job } from './job';
import { JobWorkspace } from './job-workspace';
import { Json } from './json';
import { SandboxRoom } from './sandbox-room';

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

  test('연결 확인은 MCP 설정도 도구도 없이 띄운다', async () => {
    const workspace = await JobWorkspace.open(null, '{"permissions":{}}', null, '/nowhere');
    const args = [...cli.args(workspace)];
    assert.equal(workspace.mcpReady, false);
    assert.equal(existsSync(workspace.mcpConfigPath), false);
    assert.equal(args.includes('--mcp-config'), false);
    assert.ok(args.includes('--strict-mcp-config'), '사용자의 MCP 서버를 물려받지 않는다');
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.equal(args.at(-2), '--tools', '값을 여럿 받는 옵션이라 맨 뒤에 둔다');
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

  test('결과물 폴더를 알려 주면 그 폴더와 한도를 담는다', () => {
    assert.equal(job().prompt(false).includes('결과물'), false);
    const prompt = job().prompt(false, null, '/tmp/run/work/outputs');
    assert.match(prompt, /만들면 \/tmp\/run\/work\/outputs 바로 아래에 둡니다/);
    assert.match(prompt, /100MB, 200개까지/);
  });

  test('스킬은 넣어 둔 때만 말한다', () => {
    const skilled = job({ skill: 'cairn-write' });
    assert.ok(skilled.prompt(true).includes('cairn-write'));
    assert.equal(skilled.prompt(false).includes('cairn-write'), false);
  });

  test('목표 사슬, 내 팀과 위임하는 법, 하위 작업의 결과를 담는다', () => {
    const prompt = job({
      goal_chain: [{ title: '회사' }, { title: '이번 달 글 4편' }],
      team: [
        {
          agent_id: 'w1',
          name: '글쓰기 팀원',
          role: '초안을 쓴다\n둘째 줄',
          status: 'active',
          kinds: ['general', 'draft_post'],
        },
      ],
      subtask_results: [
        {
          title: '초안',
          agent: '글쓰기 팀원',
          status: 'done',
          summary: '썼어요',
          error: null,
          outputs: [{ id: 'o1', name: '발표.pptx', kind: 'slides' }],
        },
        {
          title: '정리',
          agent: '정리 팀원',
          status: 'failed',
          summary: null,
          error: '세션이 없어요',
        },
      ],
      rounds_left: 2,
    }).prompt(false);
    assert.ok(prompt.includes('회사 › 이번 달 글 4편'));
    assert.ok(
      prompt.includes(
        '글쓰기 팀원 (agent_id: w1): 초안을 쓴다 · 맡길 수 있는 일: general, draft_post',
      ),
    );
    assert.equal(prompt.includes('둘째 줄'), false);
    assert.ok(prompt.includes('delegate_task'));
    assert.ok(prompt.includes('남은 위임 횟수: 2'));
    assert.ok(
      prompt.includes('## [완료] 초안 (글쓰기 팀원)\n썼어요\n결과물: 발표.pptx (output_id: o1)'),
    );
    assert.ok(prompt.includes('## [실패] 정리 (정리 팀원)\n세션이 없어요'));
  });

  test('대화의 회차면 이전 대화를 자료로, 답하는 법과 함께 담는다', () => {
    const chat = (history: object[]) =>
      job({
        task: {
          id: 't',
          title: '대화 · 저녁은?',
          payload: { chat: { chatId: 'c', turn: 2, history } },
        },
      });
    const prompt = chat([
      { from: 'owner', text: '주말 계획 세워 줘' },
      { from: 'agent', text: '성수 카페 어때요' },
    ]).prompt(false);
    assert.ok(prompt.includes('# 이전 대화 (자료)'));
    assert.ok(prompt.includes('[관리자] 주말 계획 세워 줘\n[나] 성수 카페 어때요'));
    assert.ok(prompt.indexOf('# 할 일') < prompt.indexOf('# 이전 대화'));
    assert.ok(prompt.includes('# 대화로 답하는 법'));
    const first = chat([]).prompt(false);
    assert.equal(first.includes('# 이전 대화'), false, '첫 회차에는 앞 대화가 없다');
    assert.ok(first.includes('# 대화로 답하는 법'));
    assert.equal(job().prompt(false).includes('대화로 답하는 법'), false, '대화가 아닌 일');
  });

  test('팀이 없으면 위임을 말하지 않고, 횟수를 다 쓰면 직접 마무리한다', () => {
    assert.equal(job().prompt(false).includes('delegate_task'), false);
    const spent = job({
      team: [{ agent_id: 'w1', name: '팀원', role: '', status: 'active', kinds: ['general'] }],
      rounds_left: 0,
    }).prompt(false);
    assert.equal(spent.includes('delegate_task'), false);
    assert.ok(spent.includes('더 맡길 수 없습니다'));
  });

  test('임대 끝을 시각으로 읽는다', () => {
    assert.equal(job().leaseUntil?.toISOString(), '2026-11-01T00:15:00.000Z');
  });
});

describe('코드 러너 칸의 코드 작업', () => {
  const TASK = '0190f5a2-0000-7000-8000-0000000000c1';
  const codeJob = (kind = 'code') =>
    Job.from(
      Json.of({
        task: { id: TASK, kind, title: '고치기', payload: { code: {} } },
        instruction: '고쳐 주세요',
        agent: { name: '코드 담당', role: '', tool: 'claude' },
        run_token: 'run-token',
      }),
    );
  const self = AgentUser.parse('self') as AgentUser;

  test('칸의 자리 안에서 셸과 찾기를 묻지 않고 허락한다. 작업 폴더는 저장소 사본, 홈 · 임시는 그 자리', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cairn-room-'));
    const room = await SandboxRoom.open(base, TASK, self);
    mkdirSync(room.cleanDir);
    await room.handOver();
    const cli = new ClaudeCli('claude', 'oauth-token', 'http://cairn-server:4000/mcp', skillsDir);
    const workspace = await cli.open(codeJob(), room);
    await workspace.handOver();
    const args = [...cli.args(workspace)];
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Edit,Bash,Glob,Grep,WebSearch');
    for (const tool of ['Bash', 'Glob', 'Grep']) assert.ok(args.includes(tool), tool);
    assert.equal(workspace.workDir, room.workDir);
    assert.equal(workspace.user, self);
    const env = cli.env(workspace, {
      PATH: '/bin',
      HTTPS_PROXY: 'http://egress:3128',
      CAIRN_RUNNER_TOKEN: 'x',
    });
    assert.equal(env.HOME, room.homeDir);
    assert.equal(env.TMPDIR, room.tmpDir);
    assert.equal(env.HTTPS_PROXY, 'http://egress:3128', '바깥은 나가는 프록시로');
    assert.equal(env.CAIRN_RUNNER_TOKEN, undefined);
    await workspace.remove();
    assert.ok(existsSync(workspace.mcpConfigPath), '칸의 자리는 SandboxRoom이 지운다');
    await room.close();
    rmSync(base, { recursive: true, force: true });
  });

  test('칸의 자리 밖이면 코드 작업이어도 셸을 열지 않는다', async () => {
    const cli = new ClaudeCli('claude', 'oauth-token', 'http://cairn-server:4000/mcp', skillsDir);
    const workspace = await cli.open(codeJob());
    const args = cli.args(workspace).join(' ');
    assert.equal(args.includes('Bash'), false);
    await workspace.remove();
  });
});

describe('서버가 실어 보낸 스킬', () => {
  const withPackage = (pkg: unknown) =>
    Job.from(
      Json.of({
        task: { id: 'task-1', kind: 'draft_post', title: '초안', payload: {} },
        instruction: '글을 써 주세요',
        agent: { name: '글쓰기', role: '', tool: 'claude' },
        run_token: 'run-token',
        skill: 'cairn-write',
        skill_package: pkg,
      }),
    );
  const pkg = {
    name: 'cairn-write',
    source: 'console',
    revision: 3,
    hash: 'a'.repeat(64),
    files: {
      'SKILL.md':
        '---\nname: cairn-write\ncairn-where: runner\n---\n콘솔 판. {{SKILL_DIR}}/references/style.md를 읽는다',
      'references/style.md': '콘솔 문체',
    },
  };

  test('받은 판을 깐다: 디스크의 skills/는 보지 않는다', async () => {
    const job = withPackage(pkg);
    assert.equal(job.skillPackage?.revision, 3);
    const cli = new ClaudeCli('claude', 'oauth-token', 'http://x/mcp', skillsDir);
    const workspace = await cli.open(job);
    const to = join(workspace.configDir, 'skills', 'cairn-write');
    assert.equal(workspace.skillReady, true);
    assert.equal(
      readFileSync(join(to, 'SKILL.md'), 'utf8').includes(`${to}/references/style.md`),
      true,
      '{{SKILL_DIR}}는 깐 자리로',
    );
    assert.equal(readFileSync(join(to, 'references', 'style.md'), 'utf8'), '콘솔 문체');
    assert.equal(existsSync(join(to, 'agents')), false, '디스크의 판(agents/ 포함)을 섞지 않는다');
    await workspace.remove();
  });

  test('경로가 스킬 폴더 밖이거나 SKILL.md가 없으면 받은 판은 없는 것이다 (옛 길로 디스크의 판을 쓴다)', async () => {
    for (const files of [
      { 'SKILL.md': 'x', '../escape.md': 'x' },
      { 'SKILL.md': 'x', 'scripts/run.sh': 'x' },
      { 'references/a.md': 'x' },
      { 'SKILL.md': 1 },
    ])
      assert.equal(withPackage({ ...pkg, files }).skillPackage, null, JSON.stringify(files));
    assert.equal(withPackage({ ...pkg, name: '../x' }).skillPackage, null);
    const old = withPackage(null);
    assert.equal(old.skillPackage, null);
    const workspace = await new ClaudeCli('claude', 'oauth-token', 'http://x/mcp', skillsDir).open(
      old,
    );
    assert.equal(workspace.skillReady, true, '옛 서버: 디스크의 cairn-write');
    await workspace.remove();
  });
});
