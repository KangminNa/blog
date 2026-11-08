import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Job } from './job';

// 브라우저 작업(browse)에 붙이는 Playwright MCP (@playwright/mcp, 버전 고정). AI CLI가 서버 브라우저를 움직이는 길이다.
// 서버 브라우저에 CDP로 붙고(--cdp-endpoint: 로그인된 프로필을 그대로 쓴다), 사이트의 허용 출처만 요청한다(--allowed-origins).
// 허용 출처는 가드레일이다: 시험(2026-11-08)에서 바로 이동 · fetch · 이미지는 막았지만 리다이렉트는 막지 못했다.
// 그래서 브라우저 작업을 맡는 에이전트는 비공개를 읽지 못한다 (서버의 browse 규칙). AI CLI에게 셸은 여전히 없다.
export class BrowserMcp {
  /** AI CLI의 MCP 설정에 쓰는 서버 이름. 격리 검사(ClaudeStream · CodexStream)가 browse 작업에서만 허락한다 */
  static readonly SERVER = 'playwright';
  /** 브라우저가 살아 있는지 묻는 시간 */
  static readonly PROBE_MS = 3_000;

  private constructor(
    /** 서버 브라우저의 CDP 주소 (CAIRN_BROWSER_URL) */
    readonly endpoint: string,
    /** 이 작업의 사이트가 허락한 출처 */
    readonly origins: readonly string[],
  ) {}

  /** 브라우저 작업이고, 이 러너에 브라우저가 있고, 사이트에 허용 출처가 있을 때만 */
  static for(job: Job, browserUrl: string | null): BrowserMcp | null {
    const origins = job.site?.origins ?? [];
    if (!job.isBrowse || browserUrl === null || origins.length === 0) return null;
    return new BrowserMcp(browserUrl, origins);
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
    return [
      BrowserMcp.cli(),
      '--cdp-endpoint',
      this.endpoint,
      '--allowed-origins',
      this.origins.join(';'),
    ];
  }

  /** 패키지가 cli.js를 exports로 열지 않아 package.json의 bin에서 찾는다 */
  private static cli(): string {
    const manifest = createRequire(__filename).resolve('@playwright/mcp/package.json');
    const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: Record<string, string> };
    return join(dirname(manifest), bin['playwright-mcp'] ?? 'cli.js');
  }
}
