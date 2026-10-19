import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { McpServerState } from './ai-tool';
import { CairnSite } from './cairn-site';
import { ClaudeCode } from './claude-code';
import { Codex } from './codex';
import { ConnectCommand } from './connect.command';
import { Shell, ShellResult } from './shell';
import { SkillMarker, SkillPackage } from './skill';
import { StatusCommand } from './status.command';
import { CliError, Terminal } from './terminal';

// cairn connect · status. 블로그는 작은 HTTP 서버로, claude · codex 명령은 가짜 Shell로 바꿔서 순서 전체를 돌린다.

/** 가짜 claude: 등록된 서버 하나를 기억하고, 받은 명령을 남긴다 */
class FakeClaude extends Shell {
  readonly calls: string[] = [];
  installed = true;
  registered: { url: string; status: string } | null = null;
  loginWorks = true;

  override async run(command: string, args: readonly string[]): Promise<ShellResult> {
    const line = [command, ...args].join(' ');
    this.calls.push(line);
    if (!this.installed) return new ShellResult(127, '', 'spawn claude ENOENT');
    if (line === 'claude --version') return new ShellResult(0, '2.1.300 (Claude Code)\n', '');
    if (line === 'claude mcp get cairn')
      return this.registered
        ? new ShellResult(
            0,
            `cairn:\n  Scope: User config (available in all your projects)\n  Status: ${this.registered.status}\n  Type: http\n  URL: ${this.registered.url}\n`,
            '',
          )
        : new ShellResult(1, '', 'No MCP server found with name: cairn');
    if (line === 'codex --version') return new ShellResult(0, 'codex-cli 0.142.5\n', '');
    if (line === 'codex mcp list')
      return new ShellResult(
        0,
        `Name     Url                              Status   Auth\n${this.registered ? `cairn    ${this.registered.url}    enabled  ${this.registered.status}\n` : ''}`,
        '',
      );
    if (args[1] === 'add') {
      this.registered = { url: String(args.at(-1)), status: '! Needs authentication' };
      return new ShellResult(0, 'Added HTTP MCP server cairn', '');
    }
    if (args[1] === 'remove') {
      this.registered = null;
      return new ShellResult(0, 'Removed', '');
    }
    return new ShellResult(1, '', `unknown: ${line}`);
  }

  override async interact(command: string, args: readonly string[]): Promise<number> {
    this.calls.push([command, ...args].join(' '));
    if (!this.loginWorks || !this.registered) return 1;
    this.registered.status = '✓ Connected';
    return 0;
  }
}

/** 화면 대신 줄을 모으고, 물으면 정해 둔 답을 한다 */
class FakeTerminal extends Terminal {
  readonly lines: string[] = [];
  readonly questions: string[] = [];

  constructor(private readonly answer = false) {
    super(false);
  }

  override say(line = ''): void {
    this.lines.push(line);
  }

  override async confirm(question: string): Promise<boolean> {
    this.questions.push(question);
    return this.answer;
  }
}

let blog: Server;
let origin: string;
/** 블로그가 돌려줄 안내 문서 (null이면 사이트 주소를 정하기 전처럼 422) */
let resource: object | null;
let home: string;
let shell: FakeClaude;
const skill = new SkillPackage(
  'cairn-save',
  new Map([
    ['SKILL.md', '---\nname: cairn-save\n---\n저장한다\n'],
    ['scripts/context.mjs', 'node {{SKILL_DIR}}/scripts/context.mjs\n'],
    ['references/tools.md', '스크립트: {{SKILL_DIR}}/scripts\n'],
    ['agents/claude/cairn-fact-reviewer.md', '---\nname: cairn-fact-reviewer\n---\n검토\n'],
    ['agents/codex/cairn_fact_reviewer.toml', 'name = "cairn_fact_reviewer"\n'],
  ]),
);

const claude = () => new ClaudeCode(shell, {}, home);
const skillDir = () => join(home, '.claude', 'skills', 'cairn-save');
const connect = (terminal = new FakeTerminal(), reviewWith: string | null = null) =>
  new ConnectCommand(terminal, claude(), [skill], reviewWith).run(origin);

before(async () => {
  blog = createServer((req, res) => {
    if (req.url !== '/.well-known/oauth-protected-resource/mcp') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(resource ? 200 : 422, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        resource ?? {
          code: 'rule_violation',
          message: '사이트 주소부터 정해 주세요 (관리 화면의 블로그 정보)',
        },
      ),
    );
  });
  await new Promise<void>((done) => blog.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(blog.address() as AddressInfo).port}`;
});
after(() => blog.close());
afterEach(() => rmSync(home, { recursive: true, force: true }));
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cairn-cli-'));
  shell = new FakeClaude();
  resource = { resource: 'https://blog.example.com/mcp', resource_name: 'Cairn' };
});

describe('블로그 주소', () => {
  test('https와 이 컴퓨터 안의 주소만. 앞에 https://가 없으면 붙인다', () => {
    assert.equal(CairnSite.parse('blog.example.com').origin, 'https://blog.example.com');
    assert.equal(CairnSite.parse('http://localhost:3000/').origin, 'http://localhost:3000');
    assert.throws(() => CairnSite.parse('http://192.168.0.10:3000'), /https 주소만/);
    assert.throws(() => CairnSite.parse('ftp://x'), /https:\/\/로 시작/);
    assert.throws(() => CairnSite.parse('http://'), /주소 모양이 아니에요/);
  });

  test('MCP 주소는 블로그가 알려 준 사이트 주소 기준. Cairn이 아니거나 사이트 주소 전이면 그 이유', async () => {
    const at = await CairnSite.parse(origin).address();
    assert.deepEqual(
      [at.site, at.mcp],
      ['https://blog.example.com', 'https://blog.example.com/mcp'],
    );
    resource = null;
    await assert.rejects(CairnSite.parse(origin).address(), /사이트 주소부터 정해 주세요/);
    resource = { resource: 'https://other.example/api', resource_name: 'Other' };
    await assert.rejects(CairnSite.parse(origin).address(), /Cairn 블로그가 아니에요/);
    await assert.rejects(CairnSite.parse('http://127.0.0.1:9').address(), /블로그에 닿지 않아요/);
  });
});

describe('cairn connect', () => {
  test('처음: 스킬과 표시를 넣고, 모든 프로젝트용으로 등록하고, 로그인한 뒤 연결을 확인한다', async () => {
    const terminal = new FakeTerminal();
    await connect(terminal);
    // Claude Code용: 묻지 않을 도구를 머리말에, {{SKILL_DIR}}은 실제 폴더로 (md만, 스크립트는 그대로)
    assert.equal(
      readFileSync(join(skillDir(), 'SKILL.md'), 'utf8'),
      `---\nname: cairn-save\nallowed-tools: mcp__cairn__check_session, mcp__cairn__save_session, Bash(node \${CLAUDE_SKILL_DIR}/scripts/*)\n---\n저장한다\n`,
    );
    assert.equal(
      readFileSync(join(skillDir(), 'references/tools.md'), 'utf8'),
      `스크립트: ${skillDir()}/scripts\n`,
    );
    assert.equal(
      readFileSync(join(skillDir(), 'scripts/context.mjs'), 'utf8'),
      'node {{SKILL_DIR}}/scripts/context.mjs\n',
    );
    // 검토자는 스킬 폴더가 아니라 ~/.claude/agents에
    const reviewer = join(home, '.claude', 'agents', 'cairn-fact-reviewer.md');
    assert.equal(readFileSync(reviewer, 'utf8'), '---\nname: cairn-fact-reviewer\n---\n검토\n');
    assert.equal(existsSync(join(skillDir(), 'agents')), false);
    assert.deepEqual(JSON.parse(readFileSync(join(skillDir(), SkillMarker.FILE), 'utf8')), {
      version: skill.version,
      site: 'https://blog.example.com',
      mcp: 'https://blog.example.com/mcp',
      tool: 'claude-code',
      review_with: null,
      agents: [reviewer],
    });
    assert.ok(
      shell.calls.includes(
        'claude mcp add --transport http --scope user cairn https://blog.example.com/mcp',
      ),
    );
    assert.ok(shell.calls.includes('claude mcp login cairn'));
    assert.equal(
      terminal.lines.at(-1),
      '작업을 마치면 Claude Code에서 "이 세션 저장해" 또는 /cairn-save',
    );
    assert.ok(terminal.lines.includes(`사이트 주소 기준으로 연결해요: https://blog.example.com`));
  });

  test('다시 부르면 된 단계는 건너뛴다 (등록·로그인 없이 연결 확인만)', async () => {
    await connect();
    shell.calls.length = 0;
    const terminal = new FakeTerminal();
    await connect(terminal);
    assert.deepEqual(shell.calls, [
      'claude --version',
      'claude mcp get cairn',
      'claude mcp get cairn',
    ]);
    assert.ok(terminal.lines.includes('✓ 스킬 cairn-save · 이미 최신'));
  });

  test('등록은 됐는데 로그인 전이면 로그인만 다시 한다', async () => {
    shell.registered = { url: 'https://blog.example.com/mcp', status: '! Needs authentication' };
    await connect();
    assert.equal(shell.calls.filter((c) => c.includes('mcp add')).length, 0);
    assert.ok(shell.calls.includes('claude mcp login cairn'));
  });

  test('다른 블로그에 연결돼 있으면 묻고, 아니라고 하면 그대로 둔다. 예라고 하면 바꾼다', async () => {
    shell.registered = { url: 'https://friend.example/mcp', status: '✓ Connected' };
    const no = new FakeTerminal(false);
    await assert.rejects(connect(no), /연결을 바꾸지 않았어요/);
    assert.match(no.questions[0] ?? '', /다른 블로그\(https:\/\/friend\.example\/mcp\)/);
    assert.equal(shell.registered?.url, 'https://friend.example/mcp');
    await connect(new FakeTerminal(true));
    assert.equal(shell.registered?.url, 'https://blog.example.com/mcp');
    assert.ok(shell.calls.includes('claude mcp remove cairn --scope user'));
  });

  test('이 명령이 넣지 않은 같은 이름의 스킬 폴더는 묻고, 아니라고 하면 건드리지 않는다', async () => {
    mkdirSync(skillDir(), { recursive: true });
    writeFileSync(join(skillDir(), 'SKILL.md'), '내가 만든 스킬');
    const no = new FakeTerminal(false);
    await assert.rejects(connect(no), /스킬 cairn-save을 넣지 않았어요/);
    assert.equal(readFileSync(join(skillDir(), 'SKILL.md'), 'utf8'), '내가 만든 스킬');
    assert.equal(shell.calls.filter((c) => c.includes('mcp add')).length, 0);
  });

  test('교차 검토 명령줄을 고르면 표시에 남기고, 다음에 고르지 않아도 그대로 둔다', async () => {
    await connect(new FakeTerminal(), 'codex');
    const read = () => JSON.parse(readFileSync(join(skillDir(), SkillMarker.FILE), 'utf8'));
    assert.equal(read().review_with, 'codex');
    await connect();
    assert.equal(read().review_with, 'codex');
  });

  test('이 명령이 넣지 않은 같은 이름의 검토자 파일은 묻고, 아니라고 하면 그것만 건너뛴다', async () => {
    const reviewer = join(home, '.claude', 'agents', 'cairn-fact-reviewer.md');
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    writeFileSync(reviewer, '내 에이전트');
    const no = new FakeTerminal(false);
    await connect(no);
    assert.match(no.questions[0] ?? '', /같은 이름의 에이전트가 있어요/);
    assert.equal(readFileSync(reviewer, 'utf8'), '내 에이전트');
  });

  test('claude 명령이 없거나, 로그인을 마치지 못하거나, 연결이 확인되지 않으면 이유와 다음 할 일', async () => {
    shell.installed = false;
    await assert.rejects(
      connect(),
      /Claude Code 명령\(claude\)을 찾을 수 없어요\. 설치: npm install/,
    );
    shell = new FakeClaude();
    shell.loginWorks = false;
    await assert.rejects(connect(), /로그인을 마치지 못했어요\. Claude Code에서 \/mcp/);
    const err = await connect().catch((e: unknown) => e);
    assert.ok(err instanceof CliError);
  });
});

describe('cairn connect --tool codex', () => {
  const codex = () => new Codex(shell, {}, home);

  test('스킬은 ~/.agents/skills, 검토자는 ~/.codex/agents에. codex mcp add · login, 연결은 Codex 안에서 확인하라고 안내', async () => {
    const terminal = new FakeTerminal();
    await new ConnectCommand(terminal, codex(), [skill]).run(origin);
    const dir = join(home, '.agents', 'skills', 'cairn-save');
    assert.equal(
      readFileSync(join(dir, 'SKILL.md'), 'utf8'),
      '---\nname: cairn-save\n---\n저장한다\n',
      '머리말은 표준 그대로',
    );
    assert.equal(
      readFileSync(join(home, '.codex', 'agents', 'cairn_fact_reviewer.toml'), 'utf8'),
      'name = "cairn_fact_reviewer"\n',
    );
    assert.equal(JSON.parse(readFileSync(join(dir, SkillMarker.FILE), 'utf8')).tool, 'codex');
    assert.ok(shell.calls.includes('codex mcp add cairn --url https://blog.example.com/mcp'));
    assert.ok(shell.calls.includes('codex mcp login cairn'));
    assert.match(terminal.lines.join('\n'), /Codex에서 \/mcp로 cairn이 연결됐는지/);
  });

  test('codex mcp list에서 cairn 줄의 주소를 읽어, 같은 블로그면 다시 등록하지 않는다', async () => {
    shell.registered = { url: 'https://blog.example.com/mcp', status: 'OAuth' };
    const state = await codex().server();
    assert.equal(state?.url, 'https://blog.example.com/mcp');
    await new ConnectCommand(new FakeTerminal(), codex(), [skill]).run(origin);
    assert.equal(shell.calls.filter((c) => c.includes('mcp add')).length, 0);
  });
});

describe('cairn status · 상태 읽기', () => {
  test('넣은 스킬의 버전과 올릴 곳, 검토자, 새 버전, 등록된 서버의 상태', async () => {
    await connect();
    const terminal = new FakeTerminal();
    const newer = new SkillPackage('cairn-save', new Map([['SKILL.md', '바뀐 스킬']]));
    await new StatusCommand(terminal, claude(), [newer]).run();
    assert.deepEqual(terminal.lines, [
      'Claude Code',
      `  스킬 cairn-save: ${skill.version} · 올릴 곳 https://blog.example.com · 새 버전 ${newer.version} (cairn connect로 바꾸기)`,
      '  검토자 1명 · 교차 검토 없음',
      '  MCP 서버 cairn: https://blog.example.com/mcp · ✓ Connected',
    ]);
  });

  test('연결 상태 글: Connected만 연결됨으로 본다', () => {
    assert.equal(new McpServerState(null, '✓ Connected').connected, true);
    assert.equal(new McpServerState(null, '! Needs authentication').connected, false);
    assert.equal(new McpServerState(null, '✗ Failed to connect').connected, false);
  });

  test('함께 든 스킬: 저장소의 cairn-save를 찾고, 내용이 같으면 버전도 같다', () => {
    const bundled = SkillPackage.bundled();
    const save = bundled.find((s) => s.name === 'cairn-save');
    for (const file of [
      'SKILL.md',
      'references/note-rules.md',
      'references/reviewers.md',
      'references/tools.md',
      'scripts/context.mjs',
      'scripts/evidence.mjs',
      'scripts/check.mjs',
      'scripts/review.mjs',
    ])
      assert.ok(save?.files.has(file), file);
    // 원본은 어느 도구에서나 읽히는 표준 머리말만: 도구 전용 줄은 설치할 때 붙인다
    assert.doesNotMatch(save?.files.get('SKILL.md') ?? '', /allowed-tools/);
    assert.match(save?.files.get('SKILL.md') ?? '', /\{\{SKILL_DIR\}\}\/scripts\/context\.mjs/);
    assert.deepEqual(
      [...(save?.agents('claude').keys() ?? [])],
      ['cairn-boundary-reviewer.md', 'cairn-fact-reviewer.md'],
    );
    assert.deepEqual(
      [...(save?.agents('codex').keys() ?? [])],
      ['cairn_boundary_reviewer.toml', 'cairn_fact_reviewer.toml'],
    );
    assert.equal(
      [...(save?.skillFiles.keys() ?? [])].some((f) => f.startsWith('agents/')),
      false,
    );
    assert.equal(save?.version, new SkillPackage('cairn-save', save?.files ?? new Map()).version);
  });
});
