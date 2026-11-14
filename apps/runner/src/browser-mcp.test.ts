import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { pause } from './backoff';
import { BrowseJob } from './browse-job';
import { BrowsePlan, BrowserMcp } from './browser-mcp';
import { BrowserPages } from './browser-page';
import { DevToolsSession } from './browser-tabs';
import { ClaudeCli } from './claude-cli';
import { ClaudeStream } from './claude-stream';
import { CodexCli } from './codex-cli';
import { CodexStream } from './codex-stream';
import { ExploreProxy } from './explore-proxy';
import { Job } from './job';
import { Json } from './json';
import { RunnerAbility } from './runner-ability';
import { RunnerConfig } from './runner-config';
import { REPO_PROMPTS } from './testing/repo-prompts';
import { TestChromium } from './testing/test-chromium';

// 브라우저 작업(browse): browser_job의 답으로 사이트 · 둘러보기를 정하고, 그 일에만 Playwright MCP를 붙이고,
// 격리 검사가 그 일에만 playwright를 허락한다. 실제 시험은 진짜 Chromium + 진짜 Playwright MCP로 본다:
// 사이트 일은 허용 출처만 열리고 MCP가 끝나도 채운 탭이 남는다(결재된 클릭의 전제), 둘러보기는 로그인 쿠키가 없고 내부 주소가 막히며 끝나면 사라진다.

const browseJob = (kind = 'browse') =>
  Job.from(
    Json.of({
      task: { id: 't1', kind, title: '블로그 글 준비', payload: {} },
      instruction: '이 소재로 글을 채워 주세요',
      agent: { name: '브라우저 담당', role: '', tool: 'claude' },
      run_token: 'run-token',
    }),
  );
const SITE = {
  id: 's1',
  version: 2,
  name: '블로그',
  start_url: 'https://blog.example/write',
  origins: ['https://blog.example', 'javascript:alert(1)', 'https://a.example/path'],
};
/** 러너가 사이트 일로 받은 작업 (BrowseStage.aiJob이 하는 일) */
const siteJob = (origins: readonly string[], outputDir = '/tmp/steps', job = browseJob()) =>
  job.withBrowse(new BrowsePlan(origins, outputDir, null), '# 사이트');

describe('브라우저 작업의 설정 (러너)', () => {
  test('browser_job의 답: 사이트 일은 사이트 값(모양이 틀린 출처는 버림) · 로그인 필요 · 붙잡은 페이지, 대상이 없으면 둘러보기', () => {
    const site = BrowseJob.from(
      Json.of({
        mode: 'site',
        site: SITE,
        login_needed: true,
        held: { click_id: 'c1', page_url: 'https://blog.example/write?d=1', tab_id: 'T1' },
      }),
    );
    assert.equal(site.explore, false);
    assert.deepEqual(site.site?.origins, ['https://blog.example']);
    assert.equal(site.loginNeeded, true);
    assert.equal(site.held?.pageUrl, 'https://blog.example/write?d=1');
    const explore = BrowseJob.from(Json.of({ mode: 'explore', site: null, held: null }));
    assert.deepEqual([explore.explore, explore.site, explore.held], [true, null, null]);
  });

  test('지시문 틀 site: 사이트 일 · 붙잡은 페이지 · 둘러보기', () => {
    const site = REPO_PROMPTS.fill('site', {
      explore: false,
      name: '블로그',
      start: 'https://blog.example/write',
      origins: 'https://blog.example',
      held: 'https://blog.example/write?d=1',
    });
    assert.match(site, /# 사이트: 블로그[\s\S]*갈 수 있는 출처: https:\/\/blog\.example/);
    assert.match(site, /browser-stop\.json/);
    assert.match(site, /붙잡아 두었던 페이지: https:\/\/blog\.example\/write\?d=1/);
    const explore = REPO_PROMPTS.fill('site', { explore: true });
    assert.match(explore, /# 둘러보기/);
    assert.doesNotMatch(explore, /# 사이트/);
    const job = siteJob(['https://blog.example']);
    const prompt = job.prompt(REPO_PROMPTS, false);
    assert.match(prompt, /# 할 일[\s\S]*# 사이트/);
    assert.match(prompt, /결재\(request_approval\)도 올리지 않습니다/, '결재는 러너가 올린다');
    assert.doesNotMatch(prompt, /request_approval로 올린 뒤 바로 끝냅니다/);
  });

  test('브라우저 작업이고, 브라우저가 있고, 자리가 정해졌을 때만 Playwright MCP를 붙인다', () => {
    assert.equal(
      BrowserMcp.for(siteJob(['https://blog.example']), null),
      null,
      '이 러너에 브라우저가 없음',
    );
    assert.equal(
      BrowserMcp.for(browseJob(), 'http://127.0.0.1:9222'),
      null,
      '아직 자리를 받지 않음',
    );
    assert.equal(
      BrowserMcp.for(
        siteJob(['https://blog.example'], '/tmp/s', browseJob('general')),
        'http://127.0.0.1:9222',
      ),
      null,
    );
    assert.equal(BrowserMcp.for(siteJob([]), 'http://127.0.0.1:9222'), null, '출처 없는 사이트 일');
    const browser = BrowserMcp.for(siteJob(['https://blog.example']), 'http://127.0.0.1:9222');
    assert.ok(browser);
    assert.equal(browser.command, process.execPath);
    assert.match(String(browser.args[0]), /@playwright[/\\]mcp[/\\]cli\.js$/);
    assert.deepEqual(browser.args.slice(1), [
      '--cdp-endpoint',
      'http://127.0.0.1:9222',
      '--allowed-origins',
      'https://blog.example',
      '--output-dir',
      '/tmp/steps',
    ]);
    const explore = BrowserMcp.for(
      browseJob().withBrowse(new BrowsePlan([], '/tmp/e', 'http://127.0.0.1:4567'), '# 둘러보기'),
      'http://127.0.0.1:9222',
    );
    assert.deepEqual(explore?.args.slice(1), [
      '--cdp-endpoint',
      'http://127.0.0.1:9222',
      '--isolated',
      '--proxy-server',
      'http://127.0.0.1:4567',
      '--output-dir',
      '/tmp/e',
    ]);
  });

  test('Claude · Codex 설정: 브라우저 작업에만 playwright를 더한다 (작업 토큰은 cairn에만)', () => {
    const browser = BrowserMcp.for(siteJob(['https://blog.example']), 'http://127.0.0.1:9222');
    const plain = JSON.parse(ClaudeCli.mcpConfig('https://c.example/mcp', 'tok'));
    assert.deepEqual(Object.keys(plain.mcpServers), ['cairn']);
    const withBrowser = JSON.parse(ClaudeCli.mcpConfig('https://c.example/mcp', 'tok', browser));
    assert.deepEqual(Object.keys(withBrowser.mcpServers), ['cairn', 'playwright']);
    assert.equal(withBrowser.mcpServers.playwright.type, 'stdio');
    assert.equal(JSON.stringify(withBrowser.mcpServers.playwright).includes('tok'), false);

    assert.doesNotMatch(CodexCli.configToml('https://c.example/mcp'), /playwright/);
    const toml = CodexCli.configToml('https://c.example/mcp', browser);
    assert.match(
      toml,
      /\[mcp_servers\.playwright\]\ncommand = ".+"\nargs = \[".+cli\.js", "--cdp-endpoint"/,
    );
    assert.match(toml, /shell_tool = false/, '셸은 그대로 꺼져 있다');
    assert.doesNotMatch(
      CodexCli.configToml(null, browser),
      /playwright/,
      '연결 확인에는 MCP가 없다',
    );
  });

  test('격리 검사: playwright는 허락한 실행에서만 괜찮다', () => {
    const init = JSON.stringify({
      type: 'system',
      subtype: 'init',
      mcp_servers: [
        { name: 'cairn', status: 'connected' },
        { name: 'playwright', status: 'connected' },
      ],
    });
    const usual = new ClaudeStream();
    usual.read(init);
    assert.deepEqual(usual.stray, ['playwright']);
    const browse = new ClaudeStream([ClaudeStream.SERVER, BrowserMcp.SERVER]);
    browse.read(init);
    assert.deepEqual(browse.stray, []);

    const call = JSON.stringify({
      type: 'item.started',
      item: {
        id: 'i1',
        type: 'mcp_tool_call',
        server: 'playwright',
        tool: 'browser_navigate',
        arguments: { url: 'https://blog.example/write' },
      },
    });
    const codexUsual = new CodexStream();
    codexUsual.read(call);
    assert.match(String(codexUsual.breach), /허락하지 않은 MCP 서버: playwright/);
    const codexBrowse = new CodexStream([CodexStream.SERVER, BrowserMcp.SERVER]);
    assert.deepEqual(
      codexBrowse.read(call).map((e) => [e.kind, e.body]),
      [['read', 'browser_navigate https://blog.example/write']],
    );
    assert.equal(codexBrowse.breach, null);
  });

  test('브라우저 작업은 서버 러너(연결 값 파일)이고 브라우저가 있을 때만 받는다', () => {
    const config = (pairing: string | null, browser: string | null) =>
      new RunnerConfig(
        'http://localhost',
        'device',
        null,
        '/없는',
        '/없는',
        pairing,
        '/없는',
        browser,
      );
    const env = { PATH: '' };
    assert.equal(
      RunnerAbility.detect(config('/run/pairing', 'http://127.0.0.1:9222'), env).toArgs().browser,
      true,
    );
    assert.equal(
      RunnerAbility.detect(config(null, 'http://127.0.0.1:9222'), env).toArgs().browser,
      false,
      '내 컴퓨터 러너',
    );
    assert.equal(RunnerAbility.detect(config('/run/pairing', null), env).toArgs().browser, false);
  });
});

describe('브라우저 작업 (실제 Chromium + Playwright MCP)', { skip: TestChromium.skip }, () => {
  let chromium: TestChromium;
  let allowed: Server;
  let other: Server;
  let allowedUrl: string;
  let otherUrl: string;
  let otherHits = 0;
  let work: string;

  const listen = async (server: Server): Promise<string> => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  /** AI CLI처럼 작업 폴더에서 MCP를 띄우고 처음 인사까지 */
  const start = async (browser: BrowserMcp): Promise<StdioMcp> => {
    const mcp = new StdioMcp(
      spawn(browser.command, [...browser.args], { cwd: work, stdio: ['pipe', 'pipe', 'ignore'] }),
    );
    await mcp.call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    mcp.notify('notifications/initialized');
    return mcp;
  };

  before(async () => {
    // 허용된 사이트: /login에 들어오면 로그인한 것처럼 쿠키를 받고, 페이지는 받은 쿠키를 그대로 보여 준다
    allowed = createServer((req, res) =>
      res
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          ...(req.url?.startsWith('/login') ? { 'set-cookie': 'sid=logged-in; Path=/' } : {}),
        })
        .end(`<title>허용</title><p id="c">쿠키:${req.headers.cookie ?? ''}</p><input id="t">`),
    );
    other = createServer((_, res) => {
      otherHits++;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<p>다른 출처</p>');
    });
    allowedUrl = await listen(allowed);
    otherUrl = await listen(other);
    chromium = await TestChromium.start();
  });

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'cairn-browse-'));
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  after(async () => {
    await chromium.stop();
    allowed.closeAllConnections();
    other.closeAllConnections();
    allowed.close();
    other.close();
  });

  test('브라우저에 닿는지 묻는다', async () => {
    assert.equal(await BrowserMcp.reachable(chromium.endpoint), true);
    assert.equal(await BrowserMcp.reachable('http://127.0.0.1:1'), false);
    assert.equal(await BrowserMcp.reachable(null), false);
  });

  test('사이트 일: 허용 출처만 열리고, 단계 화면이 쌓이고, MCP가 끝나도 채운 탭이 남는다 (결재된 클릭의 전제)', async () => {
    const steps = join(work, 'steps');
    const browser = BrowserMcp.for(siteJob([allowedUrl], steps), chromium.endpoint);
    assert.ok(browser);
    const mcp = await start(browser);
    let closed = false;
    try {
      await mcp.tool('browser_tabs', { action: 'new' });
      const opened = await mcp.tool('browser_navigate', { url: `${allowedUrl}/write` });
      assert.match(opened, /Page Title: 허용/);
      await mcp.tool('browser_evaluate', {
        function: "() => { document.querySelector('#t').value = '채운 값'; }",
      });
      await mcp.tool('browser_take_screenshot', { type: 'jpeg' });
      assert.ok(
        readdirSync(steps).some((f) => f.endsWith('.jpeg')),
        '단계 화면은 --output-dir에 쌓인다',
      );
      // 다른 출처는 다른 탭에서 (채운 탭은 그대로 둔다)
      await mcp.tool('browser_tabs', { action: 'new' });
      const blocked = await mcp.tool('browser_navigate', { url: `${otherUrl}/` });
      assert.match(blocked, /ERR_BLOCKED_BY_CLIENT/);
      assert.equal(otherHits, 0, '다른 출처 서버에 요청이 가지 않았다');
      // AI CLI가 끝나면 MCP 서버도 끝난다 (신호로 꺼도 같다)
      mcp.close();
      closed = true;
      await pause(1_000);
      const pages = new BrowserPages(chromium.endpoint);
      const tab = (await pages.tabs(AbortSignal.timeout(5_000))).find(
        (t) => t.url === `${allowedUrl}/write`,
      );
      assert.ok(tab, '채운 탭이 남는다');
      const session = await DevToolsSession.open(tab.socket, AbortSignal.timeout(5_000));
      const read = await session.send('Runtime.evaluate', {
        expression: "document.querySelector('#t').value",
        returnByValue: true,
      });
      session.close();
      assert.equal((read.result as { value?: string }).value, '채운 값', '채운 값도 그대로');
    } finally {
      if (!closed) mcp.close();
    }
  });

  test('둘러보기: 새 빈 창이라 로그인 쿠키가 없고, 내부 주소는 프록시가 막고, 끝나면 창이 사라진다', async () => {
    // 로그인된 프로필(기본 컨텍스트)에 허용 사이트의 쿠키를 심는다
    await fetch(`${chromium.endpoint}/json/new?${allowedUrl}/login`, { method: 'PUT' });
    await pause(500);
    // 시험의 사이트도 127.0.0.1이라, 다른 출처(otherUrl)만 내부 주소처럼 막는 규칙으로 본다
    const otherPort = Number(new URL(otherUrl).port);
    const proxy = await ExploreProxy.start((_, port) => port === otherPort);
    const hitsBefore = otherHits;
    const browser = BrowserMcp.for(
      browseJob().withBrowse(new BrowsePlan([], join(work, 'steps'), proxy.url), '# 둘러보기'),
      chromium.endpoint,
    );
    assert.ok(browser);
    const mcp = await start(browser);
    try {
      const opened = await mcp.tool('browser_navigate', { url: `${allowedUrl}/explore` });
      assert.match(opened, /Page Title: 허용/);
      const sent = await mcp.tool('browser_evaluate', {
        function: "() => document.querySelector('#c').textContent",
      });
      assert.match(sent, /"쿠키:"/, '로그인된 프로필의 쿠키가 가지 않는다');
      assert.ok(
        (await chromium.openUrls()).includes(`${allowedUrl}/explore`),
        '둘러보기 창이 열려 있다',
      );
      const blocked = await mcp.tool('browser_navigate', { url: `${otherUrl}/` });
      assert.doesNotMatch(blocked, /다른 출처/);
      assert.equal(otherHits, hitsBefore, '막힌 주소에 요청이 가지 않았다');
      mcp.close();
      await pause(1_000);
      const left = await chromium.openUrls();
      assert.equal(
        left.some((u) => u.endsWith('/explore') || u.startsWith('chrome-error:')),
        false,
        'MCP가 끝나면 그 창도 사라진다',
      );
      assert.ok(
        (await chromium.openUrls()).includes(`${allowedUrl}/login`),
        '로그인된 프로필의 탭은 그대로',
      );
    } finally {
      mcp.close();
      await proxy.close();
    }
  });
});

/** 시험용 MCP 클라이언트 (줄마다 JSON-RPC 하나) */
class StdioMcp {
  private next = 1;
  private readonly waiting = new Map<number, (reply: Record<string, unknown>) => void>();

  constructor(private readonly child: ChildProcess) {
    createInterface({ input: child.stdout as NodeJS.ReadableStream }).on('line', (line) => {
      const reply = JSON.parse(line) as Record<string, unknown>;
      if (typeof reply.id === 'number') this.waiting.get(reply.id)?.(reply);
    });
  }

  call(method: string, params: object): Promise<Record<string, unknown>> {
    const id = this.next++;
    return new Promise((done) => {
      this.waiting.set(id, done);
      this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  /** 도구를 부르고 답의 글만 모은다 */
  async tool(name: string, args: object): Promise<string> {
    const reply = await this.call('tools/call', { name, arguments: args });
    const content = (reply.result as { content?: { text?: string }[] } | undefined)?.content ?? [];
    return content.map((c) => c.text ?? '').join('\n');
  }

  close(): void {
    this.child.kill();
  }
}
