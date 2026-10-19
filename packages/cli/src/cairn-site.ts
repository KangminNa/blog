import { CliError } from './terminal';

/** 블로그가 알려 준 연결 자리 */
export class SiteAddress {
  constructor(
    /** 블로그의 사이트 주소 (관리 화면의 블로그 정보) */
    readonly site: string,
    /** AI 도구가 붙을 MCP 주소 */
    readonly mcp: string,
  ) {}
}

// 연결할 Cairn 블로그 하나. 주소 규칙은 서버와 같다: https만, 이 컴퓨터 안의 주소(localhost 등)만 http도.
export class CairnSite {
  private static readonly TIMEOUT_MS = 10_000;

  private constructor(readonly origin: string) {}

  static parse(input: string): CairnSite {
    let url: URL;
    try {
      url = new URL(input.includes('://') ? input : `https://${input}`);
    } catch {
      throw new CliError(`주소 모양이 아니에요: ${input}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new CliError(`https://로 시작하는 주소로 넣어 주세요: ${input}`);
    if (url.protocol === 'http:' && !CairnSite.isLocal(url.hostname))
      throw new CliError('https 주소만 쓸 수 있어요 (localhost는 http도 가능)');
    return new CairnSite(url.origin);
  }

  /**
   * 블로그에 물어 MCP 주소를 받는다 (RFC 9728 안내 문서). 사이트 주소 기준이라 입력한 주소와 다를 수 있다.
   * 사이트 주소를 아직 정하지 않았으면 블로그가 알려 준 문구를 그대로 보여준다.
   */
  async address(): Promise<SiteAddress> {
    let res: Response;
    try {
      res = await fetch(`${this.origin}/.well-known/oauth-protected-resource/mcp`, {
        signal: AbortSignal.timeout(CairnSite.TIMEOUT_MS),
      });
    } catch (error) {
      throw new CliError(`블로그에 닿지 않아요: ${this.origin} (${(error as Error).message})`);
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      if (body && typeof body.message === 'string') throw new CliError(body.message);
      throw new CliError(`Cairn 블로그가 아니에요: ${this.origin} (${res.status})`);
    }
    const resource = typeof body?.resource === 'string' ? body.resource : '';
    if (body?.resource_name !== 'Cairn' || !resource.endsWith('/mcp'))
      throw new CliError(`Cairn 블로그가 아니에요: ${this.origin}`);
    return new SiteAddress(resource.slice(0, -'/mcp'.length), resource);
  }

  private static isLocal(hostname: string): boolean {
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')
    );
  }
}
