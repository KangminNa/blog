import {
  Actor,
  Command,
  Conflict,
  DomainEvent,
  NotFound,
  Operation,
  Read,
  type RequestFields,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { AgentSitesView } from './click-views';
import { BROWSE_KIND, OPEN_CLICK, SITE_TARGET } from './job';
import { clicks, sites } from './schema';
import type { BrowserScreenGateway } from './screen.gateway';
import type { SiteRow } from './tables';
import { AskedView, ClearedView, SiteListView, SiteView } from './views';

// 브라우저 에이전트가 일하는 사이트 (2026-11-08)와 일 맡기기. 사이트(이름 · 시작 주소 · 허용 출처)를 등록하고,
// 사이트에 일을 맡기거나(대상 browser_site) 둘러보기를 맡긴다(대상 없음). 작업은 코어가 만든다 (task:request).
// 브라우저를 움직이는 건 서버 러너다(Playwright MCP + 결재된 클릭). 서버는 콘솔 화면 · 세션 지우기로만 브라우저에 붙는다.

/** 출처: http(s)://호스트[:포트]. 경로 · 사용자 정보 · 와일드카드는 받지 않는다 */
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const ORIGINS_MAX = 10;
const TITLE_MAX = 120;

type SiteInput = { name: string; startUrl: string; origins: readonly string[] };
type SiteChange = { id: string; version: number } & Partial<SiteInput>;

/** 사이트 칸 읽기. 출처 목록이 없으면 그 칸을 틀린 칸으로 모은다 */
function originsOf(f: RequestFields, required: boolean): readonly string[] | undefined {
  const list = f.optionalTextList('origins', ORIGINS_MAX, 200);
  if (list === null) {
    if (required) f.reject('origins', '허용 출처를 하나 이상 적어 주세요');
    return undefined;
  }
  return list.map((o) => o.trim().toLowerCase().replace(/\/+$/, ''));
}

/** 뜻의 검사: 출처 모양, 시작 주소가 출처 안에 있는가 */
function checkSite(site: SiteInput): SiteInput {
  if (site.origins.length === 0) throw new RuleViolation('허용 출처를 하나 이상 적어 주세요');
  const wrong = site.origins.filter((o) => !ORIGIN.test(o));
  if (wrong.length > 0)
    throw new RuleViolation(`출처는 https://호스트 모양이에요 (경로 없이): ${wrong.join(', ')}`);
  if (!URL.canParse(site.startUrl) || !site.origins.includes(new URL(site.startUrl).origin))
    throw new RuleViolation('시작 주소는 허용 출처 안에 있어야 해요');
  return { ...site, origins: [...new Set(site.origins)] };
}

async function siteOf(work: Work, actor: Actor, id: string): Promise<SiteRow> {
  const row = await work.row(sites, { id, space_id: actor.requireSpace() });
  if (!row) throw new NotFound('없는 사이트예요');
  return row;
}

/** 지시의 첫 줄 (작업 제목) */
function titleOf(prefix: string, instruction: string): string {
  const first =
    instruction
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? '';
  return `${prefix}: ${first}`.slice(0, TITLE_MAX);
}

/** GET /api/p/browser-tabs/sites: 등록한 사이트 (관리자) */
export class ListSites extends Read<null> {
  readonly name = 'sites';
  readonly allow = Operation.OWNER;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<SiteListView> {
    const rows = await work.rows(sites, { space_id: actor.requireSpace() }, { order: ['id desc'] });
    return new SiteListView(rows.map((r) => new SiteView(r)));
  }
}

/** MCP browser_sites: 등록한 사이트 (에이전트. 대표가 브라우저 담당에게 맡길 사이트를 고른다) */
export class AgentSites extends Read<null> {
  readonly name = 'agentSites';
  readonly allow = Actor.AGENT;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<AgentSitesView> {
    return new AgentSitesView(
      await work.rows(sites, { space_id: actor.requireSpace() }, { order: ['id desc'] }),
    );
  }
}

/** POST /api/p/browser-tabs/sites { name, startUrl, origins }: 사이트 등록 (관리자) */
export class CreateSite extends Command<SiteInput> {
  readonly name = 'createSite';
  readonly allow = Operation.OWNER;

  input(raw: unknown): SiteInput {
    return this.fields(raw, (f) => ({
      name: f.text('name', 60),
      startUrl: f.text('startUrl', 2000),
      origins: originsOf(f, true) ?? [],
    }));
  }

  async run(work: Work, actor: Actor, input: SiteInput): Promise<SiteView> {
    const site = checkSite(input);
    const space = actor.requireSpace();
    await work.insertRows(sites, {
      space_id: space,
      name: site.name,
      start_url: site.startUrl,
      origins: [...site.origins],
    });
    const [row] = await work.rows(sites, { space_id: space }, { order: ['id desc'], limit: 1 });
    return new SiteView(row as SiteRow);
  }
}

/** PATCH /api/p/browser-tabs/sites/:id { version, name?, startUrl?, origins? }: 사이트 고치기 (관리자) */
export class UpdateSite extends Command<SiteChange> {
  readonly name = 'updateSite';
  readonly allow = Operation.OWNER;

  input(raw: unknown): SiteChange {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      version: f.integer('version', 1, 2_147_483_647),
      name: f.optionalText('name', 60) ?? undefined,
      startUrl: f.optionalText('startUrl', 2000) ?? undefined,
      origins: originsOf(f, false),
    }));
  }

  async run(work: Work, actor: Actor, input: SiteChange): Promise<SiteView> {
    const row = await siteOf(work, actor, input.id);
    const site = checkSite({
      name: input.name ?? row.name,
      startUrl: input.startUrl ?? row.start_url,
      origins: input.origins ?? row.origins,
    });
    const changed = await work.updateRows(
      sites,
      {
        name: site.name,
        start_url: site.startUrl,
        origins: [...site.origins],
        version: input.version + 1,
        updated_at: Rule.now,
      },
      { id: input.id, space_id: actor.requireSpace(), version: input.version },
    );
    if (changed === 0) throw new Conflict('다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요');
    return new SiteView(await siteOf(work, actor, input.id));
  }
}

/** DELETE /api/p/browser-tabs/sites/:id { version }: 사이트 지우기 (관리자). 맡겨 둔 작업은 "없는 사이트"로 실패한다 */
export class DeleteSite extends Command<{ id: string; version: number }> {
  readonly name = 'deleteSite';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string; version: number } {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      version: f.integer('version', 1, 2_147_483_647),
    }));
  }

  async run(
    work: Work,
    actor: Actor,
    input: { id: string; version: number },
  ): Promise<SiteListView> {
    await siteOf(work, actor, input.id);
    const space = actor.requireSpace();
    const gone = await work.deleteRows(sites, {
      id: input.id,
      space_id: space,
      version: input.version,
    });
    if (gone === 0) throw new Conflict('다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요');
    const rows = await work.rows(sites, { space_id: space }, { order: ['id desc'] });
    return new SiteListView(rows.map((r) => new SiteView(r)));
  }
}

type AskInput = { id: string; requestId: string; instruction: string; agentId: string | null };

/** 일 맡기기의 입력 (사이트 id는 사이트 일에만) */
function askOf(f: RequestFields, raw: unknown, site: boolean): AskInput {
  const agent = (raw as { agentId?: unknown } | null)?.agentId;
  return {
    id: site ? f.uuid('id') : '',
    requestId: f.text('requestId', 100),
    instruction: f.text('instruction', 20_000),
    agentId: agent === undefined || agent === null ? null : f.uuid('agentId'),
  };
}

/**
 * POST /api/p/browser-tabs/sites/:id/tasks { requestId, instruction, agentId? }: 이 사이트에서 할 일을 맡긴다 (관리자).
 * 작업은 코어가 만든다 (task.task.requested, uses: task:request). 대상은 사이트와 그 판이고, 러너가 browser_job으로 값을 받는다.
 * 담당을 비우면 browse 권한이 있는 에이전트가 맡는다
 */
export class RequestBrowse extends Command<AskInput> {
  readonly name = 'requestBrowse';
  readonly allow = Operation.OWNER;

  input(raw: unknown): AskInput {
    return this.fields(raw, (f) => askOf(f, raw, true));
  }

  async run(work: Work, actor: Actor, input: AskInput): Promise<AskedView> {
    const site = await siteOf(work, actor, input.id);
    const requestId = `browser-tabs:${input.requestId}`;
    work.record(
      new DomainEvent('task.task.requested', 1, actor.requireSpace(), {
        requestId,
        kind: BROWSE_KIND,
        title: titleOf(site.name, input.instruction),
        instruction: input.instruction,
        agentId: input.agentId,
        targetKind: SITE_TARGET,
        targetId: site.id,
        baseVersion: site.version,
      }),
    );
    return new AskedView(requestId);
  }
}

/**
 * POST /api/p/browser-tabs/explore { requestId, instruction, agentId? }: 둘러보기를 맡긴다 (관리자).
 * 대상이 없는 browse 작업: 러너가 일마다 새 빈 컨텍스트(로그인 없음, 내부 주소 막힘)로 공개 사이트를 연다
 */
export class RequestExplore extends Command<AskInput> {
  readonly name = 'requestExplore';
  readonly allow = Operation.OWNER;

  input(raw: unknown): AskInput {
    return this.fields(raw, (f) => askOf(f, raw, false));
  }

  async run(work: Work, actor: Actor, input: AskInput): Promise<AskedView> {
    const requestId = `browser-tabs:${input.requestId}`;
    work.record(
      new DomainEvent('task.task.requested', 1, actor.requireSpace(), {
        requestId,
        kind: BROWSE_KIND,
        title: titleOf('둘러보기', input.instruction),
        instruction: input.instruction,
        agentId: input.agentId,
      }),
    );
    return new AskedView(requestId);
  }
}

/**
 * POST /api/p/browser-tabs/sites/:id/clear-session: 그 사이트 출처의 쿠키 · 저장소만 지운다 (관리자). 다른 사이트의 로그인은 그대로.
 * 표를 쓰지 않아 트랜잭션 없이 돈다 (바깥 호출을 트랜잭션 안에서 기다리지 않는다). 로그인 필요 표시는 바꾸지 않는다:
 * 다음 일이 로그인 화면을 만나면 러너가 적는다. 기다리는 클릭이 있으면 409 (그 클릭이 쓸 로그인이다)
 */
export class ClearSession extends Read<{ id: string }> {
  readonly name = 'clearSession';
  readonly allow = Operation.OWNER;

  constructor(private readonly screen: BrowserScreenGateway) {
    super();
  }

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<ClearedView> {
    const site = await siteOf(work, actor, input.id);
    const waiting = await work.exists(clicks, { site_id: site.id, status: OPEN_CLICK });
    if (waiting)
      throw new Conflict('이 사이트에서 기다리는 클릭이 있어요. 결재를 먼저 닫아 주세요');
    return new ClearedView(await this.screen.clearSite(site.origins));
  }
}
