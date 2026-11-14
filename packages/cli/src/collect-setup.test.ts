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
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { SiteAddress } from './cairn-site';
import { ClaudeCode } from './claude-code';
import { CollectSetup } from './collect-setup';
import { DeviceLogin } from './device-login';
import { NewsSetup } from './news-setup';
import { Shell, ShellResult } from './shell';
import { StatusCommand } from './status.command';
import { Terminal } from './terminal';
import { FakeCairn } from './testing/fake-cairn';

// cairn connect의 세션 저장 단계: 세션 저장 기기(OAuth scope=collect → 권한 upload만) · SessionEnd 훅 · cairn status.
// 블로그는 가짜(FakeCairn), 브라우저는 fetch로 흉내 낸다.

/** 브라우저 대신: 승인 주소를 열면 가짜 블로그가 곧바로 이 컴퓨터의 주소로 돌려보낸다 */
class FakeBrowser extends Shell {
  readonly opened: string[] = [];

  override async openBrowser(url: string): Promise<void> {
    this.opened.push(url);
    void fetch(url).catch(() => {});
  }
}

class FakeTerminal extends Terminal {
  readonly lines: string[] = [];

  override say(line = ''): void {
    this.lines.push(line);
  }
}

/** cairn status가 부르는 claude 명령: 버전과 연결된 cairn 서버 */
class FakeClaude extends Shell {
  override async run(_command: string, args: readonly string[]): Promise<ShellResult> {
    if (args[0] === '--version') return new ShellResult(0, '2.1.300 (Claude Code)\n', '');
    return new ShellResult(0, 'cairn:\n  Status: ✓ Connected\n  URL: https://b.example/mcp\n', '');
  }
}

let blog: FakeCairn;
let dir: string;
let terminal: FakeTerminal;
let browser: FakeBrowser;
let at: SiteAddress;

const settingsFile = () => join(dir, '.claude', 'settings.json');
const cairnDir = () => join(dir, '.cairn');
const settings = () => JSON.parse(readFileSync(settingsFile(), 'utf8'));
const credentials = () => JSON.parse(readFileSync(join(cairnDir(), 'credentials.json'), 'utf8'));
const login = () => new DeviceLogin(terminal, browser, 5_000);
const setup = () => new CollectSetup(terminal, settingsFile(), login(), cairnDir());
const news = () => new NewsSetup(terminal, settingsFile(), login(), cairnDir());
const script = () => join(cairnDir(), 'bin', 'cairn-collect.mjs');

before(async () => {
  blog = new FakeCairn();
  await blog.start();
  at = new SiteAddress(blog.origin, `${blog.origin}/mcp`);
});
after(() => blog.close());
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cairn-collect-setup-'));
  terminal = new FakeTerminal();
  browser = new FakeBrowser();
  blog.grant = (scope) => (scope === 'collect' ? 'upload' : (scope ?? ''));
  blog.asked.length = 0;
  blog.revoked.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('세션 저장 기기', () => {
  test('scope=collect로 승인을 받아(권한 upload만) 열쇠를 collect 키에 0600으로 두고, 토큰은 화면에 찍지 않는다', async () => {
    await news().run(at, true);
    await setup().run(at, true);
    assert.deepEqual(blog.asked, ['news', 'collect']);
    const { news: newsKey, collect } = credentials();
    assert.equal(collect.site, blog.origin);
    assert.equal(collect.mcp, `${blog.origin}/mcp`);
    assert.match(collect.access_token, /^cairn_at_/);
    assert.match(collect.device, / · 세션 저장$/);
    assert.notEqual(collect.access_token, newsKey.access_token, '소식 기기와 따로');
    assert.equal(statSync(join(cairnDir(), 'credentials.json')).mode & 0o777, 0o600);
    const printed = terminal.lines.join('\n');
    for (const secret of [collect.access_token, collect.refresh_token])
      assert.equal(printed.includes(secret), false);
    assert.ok(
      terminal.lines.some((l) => l.startsWith('✓ 세션 저장 기기') && l.includes('세션 올리기만')),
    );
    assert.ok(
      terminal.lines.some((l) => l.includes('세션 저장 기기 "') && l.includes('세션 올리기만')),
    );
  });

  test('블로그가 upload만 주지 않으면(옛 버전) 받은 토큰을 버리고 까닭을 알린다', async () => {
    blog.grant = () => 'upload read_public';
    await setup().run(at, true);
    assert.equal(blog.revoked.length, 2);
    assert.equal(existsSync(join(cairnDir(), 'credentials.json')), false);
    assert.ok(
      terminal.lines.some((l) => l.startsWith('✗ ') && l.includes('세션 저장 기기를 모르는 버전')),
    );
    assert.ok(existsSync(settingsFile()), '훅은 건다 (열쇠가 생기면 그때부터 돈다)');
  });

  test('스크립트와 함께 비밀값 무늬(secrets.mjs, cairn_run_ 포함)를 ~/.cairn/bin에 넣는다', async () => {
    await setup().run(at, false);
    assert.ok(existsSync(script()));
    for (const file of ['transcript.mjs', 'device-access.mjs', 'hook-input.mjs', 'news-state.mjs'])
      assert.ok(existsSync(join(cairnDir(), 'bin', file)), file);
    assert.match(
      readFileSync(join(cairnDir(), 'bin', 'secrets.mjs'), 'utf8'),
      /cairn_\(\?:at\|rt\|dt\|run\)_/,
    );
    assert.equal(blog.asked.length, 0, '사람이 없는 곳에서는 기기를 만들지 않는다');
  });
});

describe('SessionEnd 훅', () => {
  test('있던 훅 · 설정은 그대로 두고 SessionEnd에 우리 훅을 하나 더한다. 소식 훅과 함께 있고, 다시 불러도 하나', async () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    const mine = { hooks: [{ type: 'command', command: 'echo 내 정리' }] };
    writeFileSync(
      settingsFile(),
      JSON.stringify({ model: 'x', hooks: { SessionEnd: [mine], Stop: [{ hooks: [] }] } }),
    );
    await news().run(at, false);
    await setup().run(at, false);
    await setup().run(at, false);
    const s = settings();
    assert.equal(s.model, 'x');
    assert.deepEqual(s.hooks.Stop, [{ hooks: [] }]);
    assert.deepEqual(s.hooks.SessionEnd, [
      mine,
      { hooks: [{ type: 'command', command: `node "${script()}" hook`, timeout: 5 }] },
    ]);
    assert.equal(s.hooks.UserPromptSubmit.length, 1, '소식 훅');
    assert.ok(terminal.lines.includes('✓ 세션 저장 훅 · 이미 있음'));
    assert.ok(terminal.lines.some((l) => l.includes('.cairn.json에 {"collect": false}')));
  });

  test('경로가 바뀌었으면 우리 훅만 고친다', async () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    const old = { type: 'command', command: 'node "/old/.cairn/bin/cairn-collect.mjs" hook' };
    writeFileSync(settingsFile(), JSON.stringify({ hooks: { SessionEnd: [{ hooks: [old] }] } }));
    await setup().run(at, false);
    assert.deepEqual(settings().hooks.SessionEnd, [
      { hooks: [{ type: 'command', command: `node "${script()}" hook` }] },
    ]);
  });

  test('읽을 수 없는 설정 파일은 건드리지 않는다', async () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(settingsFile(), '[1, 2]');
    await setup().run(at, false);
    assert.equal(readFileSync(settingsFile(), 'utf8'), '[1, 2]');
    assert.ok(terminal.lines.some((l) => l.includes('읽지 못해 세션 저장 훅을 걸지 않았어요')));
  });
});

describe('cairn status', () => {
  test('세션 저장 기기 · 훅 · 마지막 저장 · 못 올린 세션을 보인다', async () => {
    assert.deepEqual(setup().state().lines, [
      '  세션 저장 기기: 없음',
      '  세션 저장 훅: 없음 · 마지막 저장: 없음 · 못 올린 세션: 없음',
    ]);
    await setup().run(at, true);
    mkdirSync(join(cairnDir(), 'outbox'), { recursive: true });
    for (const id of ['a', 'b']) writeFileSync(join(cairnDir(), 'outbox', `${id}.json`), '{}');
    writeFileSync(join(cairnDir(), 'outbox', 'c.json.1a2b.tmp'), '');
    writeFileSync(
      join(cairnDir(), 'collect.json'),
      JSON.stringify({ saved_at: '2026-11-14T10:03:00.000Z', status: 'saved' }),
    );
    const [device, hook] = setup().state().lines;
    assert.match(device ?? '', new RegExp(`세션 저장 기기: .* · 세션 저장 · ${blog.origin}$`));
    // 이 컴퓨터의 시각으로
    const saved = new Date('2026-11-14T10:03:00.000Z');
    const two = (n: number) => String(n).padStart(2, '0');
    const local = `${saved.getFullYear()}-${two(saved.getMonth() + 1)}-${two(saved.getDate())} ${two(saved.getHours())}:${two(saved.getMinutes())}`;
    assert.equal(
      hook,
      `  세션 저장 훅: 있음 · 마지막 저장: ${local} · 못 올린 세션: 2개 (다음 세션이 끝날 때 다시 올려요)`,
    );

    const credentials = JSON.parse(readFileSync(join(cairnDir(), 'credentials.json'), 'utf8'));
    writeFileSync(
      join(cairnDir(), 'credentials.json'),
      JSON.stringify({ collect: { ...credentials.collect, dead: true } }),
    );
    assert.match(setup().state().lines[0] ?? '', / · 끊김 \(cairn connect로 다시\)$/);
  });

  test('cairn status는 소식 다음에 세션 저장 줄을 찍는다', async () => {
    const home = join(dir, 'home');
    const claude = new ClaudeCode(new FakeClaude(), {}, home);
    const file = join(home, '.claude', 'settings.json');
    const devices = [
      new NewsSetup(terminal, file, login(), cairnDir()),
      new CollectSetup(terminal, file, login(), cairnDir()),
    ];
    await new StatusCommand(terminal, claude, [], devices).run();
    assert.deepEqual(terminal.lines.slice(-4), [
      '  소식 기기: 없음',
      '  소식 훅: 없음 · 상태 줄: 없음',
      '  세션 저장 기기: 없음',
      '  세션 저장 훅: 없음 · 마지막 저장: 없음 · 못 올린 세션: 없음',
    ]);
  });
});
