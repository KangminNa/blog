import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Job } from './job';

/**
 * 브라우저 작업 하나가 어디서 도는지 (BrowseStage가 browser_job의 답으로 정한다).
 * 사이트 일: 로그인된 프로필(기본 컨텍스트)에서 사이트의 허용 출처만. 둘러보기: 일마다 새 빈 컨텍스트에서 내부 주소를 막는 프록시로
 */
export class BrowsePlan {
  constructor(
    /** 사이트 일의 허용 출처. 둘러보기면 비어 있다 */
    readonly origins: readonly string[],
    /** AI가 단계마다 찍은 화면이 쌓이는 폴더 (Playwright MCP의 --output-dir). 일이 끝나면 러너가 올린다 */
    readonly outputDir: string,
    /** 둘러보기의 프록시 주소 (ExploreProxy). 사이트 일이면 null */
    readonly proxy: string | null,
  ) {}

  get explore(): boolean {
    return this.proxy !== null;
  }
}

// 브라우저 작업(browse)에 붙이는 Playwright MCP (@playwright/mcp, 버전 고정). AI CLI가 서버 브라우저를 움직이는 길이다.
// 서버 브라우저에 CDP로 붙는다 (--cdp-endpoint). 두 가지로 띄운다 (2차 3단계, 2026-11-14):
//   사이트 일: 로그인된 프로필을 그대로 쓰고 사이트의 허용 출처만 요청한다 (--allowed-origins, 가드레일).
//     MCP가 끝나도 AI가 채운 탭은 남는다 (시험으로 확인): 러너가 그 탭의 마지막 버튼을 붙잡아 결재 뒤에 누른다
//   둘러보기: 일마다 새 빈 컨텍스트(--isolated: 로그인 쿠키가 없고 MCP가 끝나면 사라진다)를 러너의 프록시로만 내보낸다
//     (--proxy-server: 이 서버 · 내부망 · 메타데이터 주소를 막는다, ExploreProxy)
// 허용 출처는 경계가 아니다 (리다이렉트는 막지 못한다). 그래서 브라우저 작업을 맡는 에이전트는 비공개를 읽지 못한다 (서버의 browse 규칙).
// AI가 단계마다 찍은 화면은 --output-dir에 쌓이고 일이 끝나면 러너가 올린다. AI CLI에게 셸은 여전히 없다.
export class BrowserMcp {
  /** AI CLI의 MCP 설정에 쓰는 서버 이름. 격리 검사(ClaudeStream · CodexStream)가 browse 작업에서만 허락한다 */
  static readonly SERVER = 'playwright';
  /** 브라우저가 살아 있는지 묻는 시간 */
  static readonly PROBE_MS = 3_000;

  private constructor(
    /** 서버 브라우저의 CDP 주소 (CAIRN_BROWSER_URL) */
    readonly endpoint: string,
    readonly plan: BrowsePlan,
  ) {}

  /** 브라우저 작업이고, 이 러너에 브라우저가 있고, 어디서 돌지 정해졌을 때만 (사이트 일은 허용 출처가 있어야 한다) */
  static for(job: Job, browserUrl: string | null): BrowserMcp | null {
    const plan = job.browse;
    if (!job.isBrowse || browserUrl === null || plan === null) return null;
    if (!plan.explore && plan.origins.length === 0) return null;
    return new BrowserMcp(browserUrl, plan);
  }

  /** 브라우저에 닿는가. 작업을 빌린 뒤 AI CLI를 띄우기 전에 묻는다 (안 되면 돌려준다) */
  static async reachable(
    browserUrl: string | null,
    timeoutMs = BrowserMcp.PROBE_MS,
  ): Promise<boolean> {
    if (browserUrl === null) return false;
    try {
      const res = await fetch(`${browserUrl}/json/version`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    }
  }

  /** MCP 서버를 띄울 실행 파일: 러너와 같은 node */
  get command(): string {
    return process.execPath;
  }

  get args(): readonly string[] {
    const { plan } = this;
    const where = plan.proxy
      ? ['--isolated', '--proxy-server', plan.proxy]
      : ['--allowed-origins', plan.origins.join(';')];
    return [
      BrowserMcp.cli(),
      '--cdp-endpoint',
      this.endpoint,
      ...where,
      '--output-dir',
      plan.outputDir,
    ];
  }

  /** 패키지가 cli.js를 exports로 열지 않아 package.json의 bin에서 찾는다 */
  private static cli(): string {
    const manifest = createRequire(__filename).resolve('@playwright/mcp/package.json');
    const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: Record<string, string> };
    return join(dirname(manifest), bin['playwright-mcp'] ?? 'cli.js');
  }
}
