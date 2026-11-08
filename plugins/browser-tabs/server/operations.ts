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
import { reads, sites } from './schema';
import type { SiteRow } from './tables';
import {
  AskedView,
  ConfirmedView,
  PendingView,
  ReadListView,
  ReadView,
  SavedView,
  SiteListView,
  SiteView,
  ViewerView,
} from './views';

// browser-tabs의 동작. 입구(REST · MCP)는 목록 파일이 정하고, 순서(권한 → 입력 → 일 → View)는 코어가 지킨다.
// 표는 자기 스키마(browser_tabs) 하나뿐이고, 읽기 · 쓰기는 코어의 조건 규칙(work.rows · insertRows …)으로 쓴다.

const REQUESTED = 'requested';
const DONE = 'done';
const FAILED = 'failed';

/** GET /api/p/browser-tabs/reads: 최근 요청과 결과 (주인) */
export class ListReads extends Read<null> {
  static readonly LIMIT = 50;
  readonly name = 'list';
  readonly allow = Operation.OWNER;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<ReadListView> {
    const rows = await work.rows(
      reads,
      { space_id: actor.requireSpace() },
      { order: ['id desc'], limit: ListReads.LIMIT },
    );
    return new ReadListView(rows.map((r) => new ReadView(r)));
  }
}

/** POST /api/p/browser-tabs/reads { url }: 읽어 달라고 한다 (주인). 러너가 browser_tab_pending으로 가져간다 */
export class RequestRead extends Command<{ url: string }> {
  readonly name = 'request';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { url: string } {
    return this.fields(raw, (f) => ({ url: f.text('url', 2000) }));
  }

  async run(work: Work, actor: Actor, input: { url: string }): Promise<ReadListView> {
    if (!/^https?:\/\//.test(input.url)) throw new RuleViolation('http · https 주소만 읽어요');
    const space = actor.requireSpace();
    await work.insertRows(reads, { space_id: space, url: input.url });
    const rows = await work.rows(reads, { space_id: space }, { order: ['id desc'], limit: 1 });
    return new ReadListView(rows.map((r) => new ReadView(r)));
  }
}

/** MCP browser_tab_pending: 읽어 달라는 주소들, 오래된 것부터 (러너) */
export class PendingReads extends Read<null> {
  static readonly LIMIT = 5;
  readonly name = 'pending';
  readonly allow = Actor.RUN;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<PendingView> {
    const rows = await work.rows(
      reads,
      { space_id: actor.requireSpace(), status: REQUESTED },
      { order: ['id'], limit: PendingReads.LIMIT },
    );
    return new PendingView(rows);
  }
}

type SaveInput = { id: string; title: string | null; body: string | null; error: string | null };

/** MCP browser_tab_save: 읽은 결과를 남긴다 (러너). 요청 하나에 한 번만 */
export class SaveRead extends Command<SaveInput> {
  readonly name = 'save';
  readonly allow = Actor.RUN;

  input(raw: unknown): SaveInput {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      title: f.optionalText('title', 300),
      body: f.optionalText('body', 200_000),
      error: f.optionalText('error', 500),
    }));
  }

  async run(work: Work, actor: Actor, input: SaveInput): Promise<SavedView> {
    const status = input.error ? FAILED : DONE;
    const saved = await work.updateRows(
      reads,
      { status, title: input.title, body: input.body, error: input.error, read_at: Rule.now },
      { id: input.id, space_id: actor.requireSpace(), status: REQUESTED },
    );
    if (saved === 0) throw new NotFound('기다리는 요청이 아니에요 (없거나 이미 남겼어요)');
    return new SavedView(input.id, status);
  }
}

// ── 브라우저 에이전트 (2026-11-08) ─────────────────────────────────────────────────────────────
// 사이트(이름 · 시작 주소 · 허용 출처)를 등록하고, 사이트에 작업을 맡기고(task:request), 발행 결재를 마무리한다.
// 브라우저를 움직이는 건 서버 러너의 AI CLI다(Playwright MCP). 서버는 브라우저를 모른다.

/** 이 패키지의 발행 결재 동작. 에이전트의 approval_actions에 넣어야 올릴 수 있다 */
export const PUBLISH_ACTION = 'browser.site.publish';
/** 출처: http(s)://호스트[:포트]. 경로 · 사용자 정보 · 와일드카드는 받지 않는다 */
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const ORIGINS_MAX = 10;

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

/** GET /api/p/browser-tabs/sites: 등록한 사이트 (주인) */
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

/** POST /api/p/browser-tabs/sites { name, startUrl, origins }: 사이트 등록 (주인) */
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

/** PATCH /api/p/browser-tabs/sites/:id { version, name?, startUrl?, origins? }: 사이트 고치기 (주인) */
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

/** DELETE /api/p/browser-tabs/sites/:id { version }: 사이트 지우기 (주인). 맡겨 둔 작업은 그때의 값으로 돈다 */
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

type BrowseInput = { id: string; requestId: string; instruction: string; agentId: string | null };

/**
 * POST /api/p/browser-tabs/sites/:id/tasks { requestId, instruction, agentId? }: 이 사이트에서 할 일을 맡긴다 (주인).
 * 작업은 코어가 만든다 (task.task.requested, uses: task:request). 담당을 비우면 browse 권한이 있는 에이전트가 맡는다
 */
export class RequestBrowse extends Command<BrowseInput> {
  static readonly TITLE_MAX = 120;
  readonly name = 'requestBrowse';
  readonly allow = Operation.OWNER;

  input(raw: unknown): BrowseInput {
    const agent = (raw as { agentId?: unknown } | null)?.agentId;
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      requestId: f.text('requestId', 100),
      instruction: f.text('instruction', 20_000),
      agentId: agent === undefined || agent === null ? null : f.uuid('agentId'),
    }));
  }

  async run(work: Work, actor: Actor, input: BrowseInput): Promise<AskedView> {
    const site = await siteOf(work, actor, input.id);
    const first =
      input.instruction
        .split('\n')
        .find((l) => l.trim())
        ?.trim() ?? '';
    const requestId = `browser-tabs:${input.requestId}`;
    work.record(
      new DomainEvent('task.task.requested', 1, actor.requireSpace(), {
        requestId,
        kind: 'browse',
        title: `${site.name}: ${first}`.slice(0, RequestBrowse.TITLE_MAX),
        instruction: input.instruction,
        agentId: input.agentId,
        payload: {
          site: {
            id: site.id,
            version: site.version,
            name: site.name,
            startUrl: site.start_url,
            origins: site.origins,
          },
        },
      }),
    );
    return new AskedView(requestId);
  }
}

/** GET /api/p/browser-tabs/viewer: Caddy가 브라우저 화면을 넘기기 전에 묻는 주인 확인 (forward_auth) */
export class Viewer extends Read<null> {
  readonly name = 'viewer';
  readonly allow = Operation.OWNER;

  input(): null {
    return null;
  }

  async run(): Promise<ViewerView> {
    return new ViewerView();
  }
}

type GrantedInput = { approvalId: string; action: string; spaceId: string };

/**
 * task.approval.granted를 받으면 (코어가 돌림): 이 패키지의 발행 결재면 "주인이 직접 발행했다"는 결과를 남겨 작업을 끝낸다.
 * 서버는 발행하지 않는다. 주인이 콘솔의 브라우저 화면에서 직접 누르고 승인한다
 */
export class ConfirmPublish extends Command<GrantedInput> {
  readonly name = 'confirmPublish';
  readonly allow = Operation.SYSTEM;

  input(raw: unknown): GrantedInput {
    return this.fields(raw, (f) => ({
      approvalId: f.uuid('approvalId'),
      action: f.text('action', 100),
      spaceId: f.uuid('spaceId'),
    }));
  }

  async run(work: Work, _actor: Actor, input: GrantedInput): Promise<ConfirmedView> {
    if (input.action !== PUBLISH_ACTION) return new ConfirmedView(false);
    work.record(
      new DomainEvent('plugin.browser_tabs.publish_confirmed', 1, input.spaceId, {
        approvalId: input.approvalId,
        outcome: 'done',
      }),
    );
    return new ConfirmedView(true);
  }
}
