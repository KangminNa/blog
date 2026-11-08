import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createInterface } from 'node:readline';
import { after, before, describe, test } from 'node:test';
import { BrowserMcp } from './browser-mcp';
import { ClaudeCli } from './claude-cli';
import { ClaudeStream } from './claude-stream';
import { CodexCli } from './codex-cli';
import { CodexStream } from './codex-stream';
import { Job } from './job';
import { Json } from './json';
import { RunnerAbility } from './runner-ability';
import { RunnerConfig } from './runner-config';
import { TestChromium } from './testing/test-chromium';

// 브라우저 작업(browse): 사이트를 읽고, 그 일에만 Playwright MCP를 붙이고, 격리 검사가 그 일에만 playwright를 허락한다.
// 실제 시험은 진짜 Chromium + 진짜 Playwright MCP로 허용 출처는 열리고 다른 출처는 막히는지 본다.

const browseJob = (site: object, kind = 'browse') =>
  Job.from(
    Json.of({
      task: { id: 't1', kind, title: '블로그 글 준비', payload: { site } },
      instruction: '이 소재로 글을 채워 주세요',
      agent: { name: '브라우저 담당', role: '', tool: 'claude' },
      run_token: 'run-token',
    }),
  );
const SITE = {
  name: '블로그',
  startUrl: 'https://blog.example/write',
  origins: ['https://blog.example'],
};

describe('브라우저 작업의 설정 (러너)', () => {
  test('사이트를 읽어 지시문에 넣고, 모양이 틀린 출처는 버린다', () => {
    const job = browseJob({
      ...SITE,
      origins: ['https://blog.example', 'javascript:alert(1)', 'https://a.example/path'],
    });
    assert.equal(job.isBrowse, true);
    assert.deepEqual(job.site?.origins, ['https://blog.example']);
    assert.match(
      job.prompt(false),
      /# 사이트: 블로그[\s\S]*갈 수 있는 출처: https:\/\/blog\.example/,
    );
    assert.equal(
      browseJob(SITE, 'general').site,
      null,
      '브라우저 작업이 아니면 사이트를 읽지 않는다',
    );
    assert.equal(browseJob({ ...SITE, origins: [] }).site, null);
  });

  test('브라우저 작업이고, 브라우저가 있고, 허용 출처가 있을 때만 Playwright MCP를 붙인다', () => {
    assert.equal(BrowserMcp.for(browseJob(SITE), null), null, '이 러너에 브라우저가 없음');
    assert.equal(BrowserMcp.for(browseJob(SITE, 'general'), 'http://127.0.0.1:9222'), null);
    const browser = BrowserMcp.for(browseJob(SITE), 'http://127.0.0.1:9222');
    assert.ok(browser);
    assert.equal(browser.command, process.execPath);
    assert.match(String(browser.args[0]), /@playwright[/\\]mcp[/\\]cli\.js$/);
    assert.deepEqual(browser.args.slice(1), [
      '--cdp-endpoint',
      'http://127.0.0.1:9222',
      '--allowed-origins',
      'https://blog.example',
    ]);
  });

  test('Claude · Codex 설정: 브라우저 작업에만 playwright를 더한다 (작업 토큰은 cairn에만)', () => {
    const browser = BrowserMcp.for(browseJob(SITE), 'http://127.0.0.1:9222');
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

  const listen = async (server: Server): Promise<string> => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  before(async () => {
    allowed = createServer((_, res) =>
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<title>허용</title><p>허용된 출처의 편집기</p>'),
    );
    other = createServer((_, res) => {
      otherHits++;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<p>다른 출처</p>');
    });
    allowedUrl = await listen(allowed);
    otherUrl = await listen(other);
    chromium = await TestChromium.start();
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

  test('허용 출처는 열리고, 다른 출처로 바로 가면 막힌다 (요청이 도착하지 않는다)', async () => {
    const browser = BrowserMcp.for(
      browseJob({ name: '시험', startUrl: `${allowedUrl}/`, origins: [allowedUrl] }),
      chromium.endpoint,
    );
    assert.ok(browser);
    const mcp = new StdioMcp(
      spawn(browser.command, [...browser.args], { stdio: ['pipe', 'pipe', 'ignore'] }),
    );
    try {
      await mcp.call('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      });
      mcp.notify('notifications/initialized');
      const opened = await mcp.tool('browser_navigate', { url: `${allowedUrl}/` });
      assert.match(opened, /Page Title: 허용/);
      const blocked = await mcp.tool('browser_navigate', { url: `${otherUrl}/` });
      assert.match(blocked, /ERR_BLOCKED_BY_CLIENT/);
      assert.equal(otherHits, 0, '다른 출처 서버에 요청이 가지 않았다');
      await mcp.tool('browser_close', {});
    } finally {
      mcp.close();
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
