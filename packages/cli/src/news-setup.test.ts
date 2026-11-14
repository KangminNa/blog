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
import { NewsLogin } from './news-login';
import { NewsSetup } from './news-setup';
import { Shell } from './shell';
import { Terminal } from './terminal';
import { FakeCairn } from './testing/fake-cairn';

// cairn connect의 소식 단계: 소식 기기(OAuth scope=news) · 훅 · 상태 줄. 블로그는 가짜(FakeCairn), 브라우저는 fetch로 흉내 낸다.

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

let blog: FakeCairn;
let dir: string;
let terminal: FakeTerminal;
let browser: FakeBrowser;
let at: SiteAddress;

const settingsFile = () => join(dir, '.claude', 'settings.json');
const cairnDir = () => join(dir, '.cairn');
const settings = () => JSON.parse(readFileSync(settingsFile(), 'utf8'));
const credentials = () => JSON.parse(readFileSync(join(cairnDir(), 'credentials.json'), 'utf8'));
const setup = () =>
  new NewsSetup(terminal, settingsFile(), new NewsLogin(terminal, browser, 5_000), cairnDir());
const script = () => join(cairnDir(), 'bin', 'cairn-news.mjs');

before(async () => {
  blog = new FakeCairn();
  await blog.start();
  at = new SiteAddress(blog.origin, `${blog.origin}/mcp`);
});
after(() => blog.close());
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cairn-news-setup-'));
  terminal = new FakeTerminal();
  browser = new FakeBrowser();
  blog.grantScope = 'news';
  blog.asked.length = 0;
  blog.revoked.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('소식 기기', () => {
  test('scope=news로 승인을 받아 열쇠를 0600 파일에 두고, 토큰은 화면에 찍지 않는다', async () => {
    await setup().run(at, true);
    assert.deepEqual(blog.asked, ['news']);
    assert.equal(browser.opened.length, 1);
    const news = credentials().news;
    assert.equal(news.site, blog.origin);
    assert.equal(news.mcp, `${blog.origin}/mcp`);
    assert.match(news.access_token, /^cairn_at_/);
    assert.match(news.refresh_token, /^cairn_rt_/);
    assert.match(news.device, / · 소식$/);
    assert.equal(statSync(join(cairnDir(), 'credentials.json')).mode & 0o777, 0o600);
    assert.equal(statSync(cairnDir()).mode & 0o777, 0o700);
    const printed = terminal.lines.join('\n');
    assert.equal(printed.includes(news.access_token), false);
    assert.equal(printed.includes(news.refresh_token), false);
    assert.ok(terminal.lines.some((l) => l.startsWith('✓ 소식 기기') && l.includes('소식 읽기만')));
  });

  test('이미 있으면 다시 만들지 않고, 다른 열쇠는 그대로 둔다', async () => {
    mkdirSync(cairnDir(), { recursive: true });
    writeFileSync(join(cairnDir(), 'credentials.json'), JSON.stringify({ other: { keep: 1 } }));
    await setup().run(at, true);
    await setup().run(at, true);
    assert.equal(browser.opened.length, 1, '두 번째는 승인을 묻지 않는다');
    assert.deepEqual(credentials().other, { keep: 1 });
    assert.ok(terminal.lines.some((l) => l.includes('이미 연결됨')));
  });

  test('블로그가 news를 모르는 버전이면 받은 토큰을 버리고 까닭을 알린다 (넓은 토큰을 두지 않는다)', async () => {
    blog.grantScope = 'upload read_public';
    await setup().run(at, true);
    assert.equal(blog.revoked.length, 2, 'access · refresh 둘 다 버린다');
    assert.equal(existsSync(join(cairnDir(), 'credentials.json')), false);
    assert.ok(terminal.lines.some((l) => l.startsWith('✗ ') && l.includes('모르는 버전')));
    assert.ok(existsSync(settingsFile()), '훅 · 상태 줄은 건다');
  });

  test('사람이 없는 곳에서는 기기를 만들지 않고 훅 · 상태 줄만 건다', async () => {
    await setup().run(at, false);
    assert.equal(browser.opened.length, 0);
    assert.equal(existsSync(join(cairnDir(), 'credentials.json')), false);
    assert.ok(existsSync(script()));
    assert.ok(settings().statusLine);
  });
});

describe('훅 · 상태 줄', () => {
  test('있던 훅은 그대로 두고 UserPromptSubmit에 우리 훅을 하나 더한다. 다시 불러도 하나', async () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    const mine = { hooks: [{ type: 'command', command: 'echo 내 훅' }] };
    writeFileSync(
      settingsFile(),
      JSON.stringify({
        model: 'x',
        hooks: { UserPromptSubmit: [mine], PreToolUse: [{ matcher: 'Bash', hooks: [] }] },
      }),
    );
    await setup().run(at, false);
    await setup().run(at, false);
    const s = settings();
    assert.equal(s.model, 'x');
    assert.deepEqual(s.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [] }]);
    assert.equal(s.hooks.UserPromptSubmit.length, 2);
    assert.deepEqual(s.hooks.UserPromptSubmit[0], mine);
    assert.deepEqual(s.hooks.UserPromptSubmit[1], {
      hooks: [{ type: 'command', command: `node "${script()}" hook`, timeout: 5 }],
    });
    assert.deepEqual(s.statusLine, {
      type: 'command',
      command: `node "${script()}" status`,
      padding: 0,
    });
    assert.ok(terminal.lines.includes('✓ 훅 · 이미 있음'));
  });

  test('사용자의 상태 줄은 덮지 않고 붙이는 법을 알린다', async () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    const own = { type: 'command', command: '~/bin/my-status' };
    writeFileSync(settingsFile(), JSON.stringify({ statusLine: own }));
    await setup().run(at, false);
    assert.deepEqual(settings().statusLine, own);
    assert.ok(terminal.lines.some((l) => l.startsWith('상태 줄이 이미 있어 그대로 뒀어요')));
    assert.ok(terminal.lines.includes(`  node "${script()}" status`));
    assert.equal(setup().state().statusLine, 'other');
  });

  test('읽을 수 없는 설정 파일은 건드리지 않는다', async () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(settingsFile(), '{ 깨진');
    await setup().run(at, false);
    assert.equal(readFileSync(settingsFile(), 'utf8'), '{ 깨진');
    assert.ok(terminal.lines.some((l) => l.includes('읽지 못해 훅 · 상태 줄을 걸지 않았어요')));
  });

  test('cairn status는 소식 기기 · 훅 · 상태 줄을 보인다', async () => {
    assert.deepEqual(setup().state().lines, [
      '  소식 기기: 없음',
      '  소식 훅: 없음 · 상태 줄: 없음',
    ]);
    await setup().run(at, true);
    const [device, hook] = setup().state().lines;
    assert.match(device ?? '', new RegExp(`소식 기기: .* · 소식 · ${blog.origin}$`));
    assert.equal(hook, '  소식 훅: 있음 · 상태 줄: 있음');
  });
});
