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
import { pulls, repos } from './schema';
import type { PullRow, RepoRow } from './tables';
import {
  AskedView,
  ConfirmedView,
  CredentialView,
  PullListView,
  PullOpenedView,
  PullView,
  RepoListView,
  RepoView,
} from './views';

// code-github의 동작 (코드 작업 4단계, docs/코드작업.md 5장).
//   주인: 저장소 등록 · 고치기 · 보관, 일 맡기기(task:request, kind code), PR 보기
//   칸 러너: code_credential(토큰 · 이미 연 PR), code_pull_opened(PR 남기기). 둘 다 그 작업의 임대를 쥔 칸 기기만 (work.leased)
//   결재: code.pr.merge 승인을 받으면 판이 같은지 보고 결과를 남긴다. 머지는 주인이 GitHub에서 직접 한다 (6단계에서 서버가)
// 입구(REST · MCP)는 목록 파일이 정하고, 순서(권한 → 입력 → 일 → View)는 코어가 지킨다.

/** 이 패키지의 결재 동작. 에이전트의 approval_actions에 넣어야 올릴 수 있다 */
export const MERGE_ACTION = 'code.pr.merge';
/** 결재 대상의 종류 (target_kind) */
export const PULL_TARGET = 'pull_request';
const CODE_KIND = 'code';
const VERSION_MAX = 2_147_483_647;
/** https://<호스트>/<owner>/<이름>[.git]. 자격(@)이 든 주소는 받지 않는다 (러너의 CodeSpec과 같은 규칙: http는 이 컴퓨터만) */
const REPO_URL = /^https?:\/\/[^/@\s]+\/[^/\s]+\/[^/\s]+$/;
const LOCAL_HTTP = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//;
const BASE = /^[A-Za-z0-9._/-]{1,100}$/;
const PATHS_MAX = 20;
const PATH_MAX = 200;
const CHECKS_MAX = 10;
const CHECK_MAX = 500;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 막는 것이 목적이다
const CONTROL = /[\u0000-\u001f\u007f]/;

type RepoInput = {
  name: string;
  url: string;
  base: string;
  setup: string;
  checks: readonly string[];
};
type RepoChange = { id: string; version: number } & Partial<Omit<RepoInput, 'url'>>;

function checksOf(f: RequestFields): readonly string[] | undefined {
  const list = f.optionalTextList('checks', CHECKS_MAX, CHECK_MAX);
  return list === null ? undefined : list.map((c) => c.trim()).filter(Boolean);
}

/** 뜻의 검사: 주소 · 기준 브랜치 · 명령 (러너가 다시 본다) */
function checkRepo(repo: RepoInput): RepoInput {
  const url = repo.url.trim().replace(/\/+$/, '');
  if (!REPO_URL.test(url) || (url.startsWith('http:') && !LOCAL_HTTP.test(url)))
    throw new RuleViolation('저장소 주소는 https://github.com/<owner>/<이름> 모양이에요');
  if (!BASE.test(repo.base) || repo.base.includes('..'))
    throw new RuleViolation('기준 브랜치 이름이 틀려요');
  for (const command of [repo.setup, ...repo.checks])
    if (CONTROL.test(command.replace(/\n/g, ' ')))
      throw new RuleViolation('명령에 제어 문자를 쓸 수 없어요');
  return { ...repo, url, name: repo.name.trim() };
}

/** 고칠 수 있는 곳: 저장소 안의 상대 경로 접두어. "."은 저장소 전체 (러너의 CodeSpec이 다시 본다) */
function checkPaths(paths: readonly string[]): readonly string[] {
  const clean = paths.map((p) => p.trim().replace(/\/+$/, '')).filter(Boolean);
  if (clean.length === 0) throw new RuleViolation('고칠 수 있는 곳(paths)을 하나 이상 적어 주세요');
  const wrong = clean.filter(
    (p) =>
      p.startsWith('/') ||
      p.split('/').includes('..') ||
      CONTROL.test(p) ||
      p.toLowerCase().startsWith('.github/workflows'),
  );
  if (wrong.length > 0)
    throw new RuleViolation(
      `저장소 안의 상대 경로만 (.. · / 로 시작 · .github/workflows는 안 돼요): ${wrong.join(', ')}`,
    );
  return [...new Set(clean)];
}

async function repoOf(work: Work, spaceId: string, id: string): Promise<RepoRow> {
  const row = await work.row(repos, { id, space_id: spaceId });
  if (!row) throw new NotFound('없는 저장소예요');
  return row;
}

/** 칸 러너가 지금 쥔 code 작업과 그 저장소. 칸이 아니거나 · 임대가 없거나 · code가 아니면 거절 */
async function leasedCode(
  work: Work,
  actor: Actor,
  taskId: string,
): Promise<{ repo: RepoRow; taskId: string }> {
  if (!actor.inSandbox()) throw new RuleViolation('코드 러너 칸만 부를 수 있어요');
  const task = await work.leased(taskId);
  if (task.kind !== CODE_KIND) throw new RuleViolation('코드 작업이 아니에요');
  const repoId = (task.payload as { code?: { repo?: { id?: unknown } } } | null)?.code?.repo?.id;
  if (typeof repoId !== 'string') throw new RuleViolation('이 패키지가 맡긴 코드 작업이 아니에요');
  return { repo: await repoOf(work, actor.requireSpace(), repoId), taskId: task.id };
}

/** GET /api/p/code-github/repos: 등록한 저장소 (주인). 보관한 것은 빼고 */
export class ListRepos extends Read<null> {
  readonly name = 'listRepos';
  readonly allow = Operation.OWNER;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<RepoListView> {
    const rows = await work.rows(
      repos,
      { space_id: actor.requireSpace(), archived_at: null },
      { order: ['id desc'] },
    );
    return new RepoListView(rows.map((r) => new RepoView(r)));
  }
}

/** POST /api/p/code-github/repos { name, url, base?, setup?, checks? }: 저장소 등록 (주인) */
export class CreateRepo extends Command<RepoInput> {
  readonly name = 'createRepo';
  readonly allow = Operation.OWNER;

  input(raw: unknown): RepoInput {
    return this.fields(raw, (f) => ({
      name: f.text('name', 60),
      url: f.text('url', 300),
      base: f.optionalText('base', 100) ?? 'main',
      setup: f.optionalText('setup', 2000) ?? '',
      checks: checksOf(f) ?? [],
    }));
  }

  async run(work: Work, actor: Actor, input: RepoInput): Promise<RepoView> {
    const repo = checkRepo(input);
    const space = actor.requireSpace();
    if (await work.exists(repos, { space_id: space, url: repo.url, archived_at: null }))
      throw new Conflict('이미 등록한 저장소예요');
    await work.insertRows(repos, {
      space_id: space,
      name: repo.name,
      url: repo.url,
      base: repo.base,
      setup: repo.setup,
      checks: [...repo.checks],
    });
    const row = await work.row(repos, { space_id: space, url: repo.url, archived_at: null });
    return new RepoView(row as RepoRow);
  }
}

/** PATCH /api/p/code-github/repos/:id { version, name?, base?, setup?, checks? }: 고치기 (주인). 주소는 바꾸지 않는다 */
export class UpdateRepo extends Command<RepoChange> {
  readonly name = 'updateRepo';
  readonly allow = Operation.OWNER;

  input(raw: unknown): RepoChange {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      version: f.integer('version', 1, VERSION_MAX),
      name: f.optionalText('name', 60) ?? undefined,
      base: f.optionalText('base', 100) ?? undefined,
      setup:
        (raw as { setup?: unknown } | null)?.setup === ''
          ? ''
          : (f.optionalText('setup', 2000) ?? undefined),
      checks: checksOf(f),
    }));
  }

  async run(work: Work, actor: Actor, input: RepoChange): Promise<RepoView> {
    const space = actor.requireSpace();
    const row = await repoOf(work, space, input.id);
    if (row.archived_at) throw new RuleViolation('보관한 저장소는 고칠 수 없어요');
    const repo = checkRepo({
      name: input.name ?? row.name,
      url: row.url,
      base: input.base ?? row.base,
      setup: input.setup ?? row.setup,
      checks: input.checks ?? row.checks,
    });
    const changed = await work.updateRows(
      repos,
      {
        name: repo.name,
        base: repo.base,
        setup: repo.setup,
        checks: [...repo.checks],
        version: input.version + 1,
        updated_at: Rule.now,
      },
      { id: input.id, space_id: space, version: input.version },
    );
    if (changed === 0) throw new Conflict('다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요');
    return new RepoView(await repoOf(work, space, input.id));
  }
}

/** POST /api/p/code-github/repos/:id/archive { version }: 보관 (주인). 지난 PR 기록은 남고 새 일은 맡길 수 없다 */
export class ArchiveRepo extends Command<{ id: string; version: number }> {
  readonly name = 'archiveRepo';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string; version: number } {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      version: f.integer('version', 1, VERSION_MAX),
    }));
  }

  async run(work: Work, actor: Actor, input: { id: string; version: number }): Promise<RepoView> {
    const space = actor.requireSpace();
    const changed = await work.updateRows(
      repos,
      { archived_at: Rule.now, version: input.version + 1, updated_at: Rule.now },
      { id: input.id, space_id: space, version: input.version, archived_at: null },
    );
    if (changed === 0) {
      await repoOf(work, space, input.id);
      throw new Conflict('다른 곳에서 먼저 바뀌었어요. 새로 불러와 주세요');
    }
    return new RepoView(await repoOf(work, space, input.id));
  }
}

type CodeInput = {
  id: string;
  requestId: string;
  instruction: string;
  paths: readonly string[];
  agentId: string | null;
};

/**
 * POST /api/p/code-github/repos/:id/tasks { requestId, instruction, paths, agentId? }: 이 저장소에 코드 작업을 맡긴다 (주인).
 * 작업은 코어가 만든다 (task.task.requested, kind code). 그때의 저장소 값(주소 · 기준 · 명령)이 작업에 실린다
 */
export class RequestCode extends Command<CodeInput> {
  static readonly TITLE_MAX = 120;
  readonly name = 'requestCode';
  readonly allow = Operation.OWNER;

  input(raw: unknown): CodeInput {
    const agent = (raw as { agentId?: unknown } | null)?.agentId;
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      requestId: f.text('requestId', 100),
      instruction: f.text('instruction', 20_000),
      paths: f.optionalTextList('paths', PATHS_MAX, PATH_MAX) ?? [],
      agentId: agent === undefined || agent === null ? null : f.uuid('agentId'),
    }));
  }

  async run(work: Work, actor: Actor, input: CodeInput): Promise<AskedView> {
    const space = actor.requireSpace();
    const repo = await repoOf(work, space, input.id);
    if (repo.archived_at) throw new RuleViolation('보관한 저장소에는 일을 맡길 수 없어요');
    const paths = checkPaths(input.paths);
    const first =
      input.instruction
        .split('\n')
        .find((l) => l.trim())
        ?.trim() ?? '';
    const requestId = `code-github:${input.requestId}`;
    work.record(
      new DomainEvent('task.task.requested', 1, space, {
        requestId,
        kind: CODE_KIND,
        title: `${repo.name}: ${first}`.slice(0, RequestCode.TITLE_MAX),
        instruction: input.instruction,
        agentId: input.agentId,
        payload: {
          code: {
            repo: { id: repo.id, url: repo.url, base: repo.base },
            paths,
            setup: repo.setup,
            checks: repo.checks,
          },
        },
      }),
    );
    return new AskedView(requestId);
  }
}

/** GET /api/p/code-github/pulls?status=: 러너가 연 PR (주인). 최근 것부터 */
export class ListPulls extends Read<{ status: string | null }> {
  static readonly LIMIT = 100;
  readonly name = 'listPulls';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { status: string | null } {
    return this.fields(raw, (f) => ({ status: f.optionalText('status', 20) }));
  }

  async run(work: Work, actor: Actor, input: { status: string | null }): Promise<PullListView> {
    const rows = await work.sql<(PullRow & { repo_name: string })[]>`
      SELECT p.*, r.name AS repo_name FROM code_github.pulls p
      JOIN code_github.repos r ON r.id = p.repo_id
      WHERE p.space_id = ${actor.requireSpace()}
        ${input.status === null ? work.sql`` : work.sql`AND p.status = ${input.status}`}
      ORDER BY p.id DESC LIMIT ${ListPulls.LIMIT}`;
    return new PullListView(rows.map((r) => new PullView(r, r.repo_name)));
  }
}

/** GET /api/p/code-github/pulls/:id: PR 하나 (주인. 결재 화면이 code.pr.merge의 대상을 보여 줄 때) */
export class GetPull extends Read<{ id: string }> {
  readonly name = 'pull';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<PullView> {
    const space = actor.requireSpace();
    const row = await work.row(pulls, { id: input.id, space_id: space });
    if (!row) throw new NotFound('없는 PR이에요');
    return new PullView(row, (await repoOf(work, space, row.repo_id)).name);
  }
}

/** MCP code_credential { task_id }: 저장소 토큰과 이미 연 PR (칸 러너. 그 작업의 임대를 쥔 칸만) */
export class Credential extends Read<{ taskId: string }> {
  readonly name = 'credential';
  readonly allow = Actor.RUN;

  constructor(
    /** 패키지 설정의 토큰. 비어 있으면 거절한다 */
    private readonly token: string,
    private readonly apiUrl: string,
  ) {
    super();
  }

  input(raw: unknown): { taskId: string } {
    return this.fields(raw, (f) => ({ taskId: f.uuid('task_id') }));
  }

  async run(work: Work, actor: Actor, input: { taskId: string }): Promise<CredentialView> {
    const { taskId } = await leasedCode(work, actor, input.taskId);
    if (!this.token)
      throw new RuleViolation('GitHub 토큰이 없어요. 플러그인 설정(code-github)에 넣어 주세요');
    const pull = await work.row(pulls, { task_id: taskId, space_id: actor.requireSpace() });
    return new CredentialView(this.token, this.apiUrl, pull);
  }
}

type OpenedInput = {
  taskId: string;
  number: number;
  url: string;
  branch: string;
  headSha: string;
  checks: { command: string; ok: boolean }[];
};

/**
 * MCP code_pull_opened: 러너가 연(고친) PR을 남긴다 (칸 러너. 그 작업의 임대를 쥔 칸만).
 * 같은 작업이면 한 줄을 고치고, head가 바뀌면 판(version)을 올린다: 결재는 이 판으로 올라가 승인한 판만 받는다
 */
export class PullOpened extends Command<OpenedInput> {
  readonly name = 'pullOpened';
  readonly allow = Actor.RUN;

  input(raw: unknown): OpenedInput {
    return this.fields(raw, (f) => ({
      taskId: f.uuid('task_id'),
      number: f.integer('number', 1, VERSION_MAX),
      url: f.text('url', 500),
      branch: f.text('branch', 60),
      headSha: f.text('head_sha', 40),
      checks: f.nestedList('checks', CHECKS_MAX).map((c) => ({
        command: c.text('command', CHECK_MAX),
        ok: c.boolean('ok'),
      })),
    }));
  }

  async run(work: Work, actor: Actor, input: OpenedInput): Promise<PullOpenedView> {
    const { repo, taskId } = await leasedCode(work, actor, input.taskId);
    const space = actor.requireSpace();
    if (input.branch !== `cairn/${taskId}`)
      throw new RuleViolation(`이 작업의 브랜치는 cairn/${taskId}예요`);
    if (!/^[0-9a-f]{40}$/.test(input.headSha)) throw new RuleViolation('head_sha가 틀려요');
    if (!/^https?:\/\//.test(input.url)) throw new RuleViolation('PR 주소가 틀려요');
    const before = await work.row(pulls, { task_id: taskId, space_id: space });
    if (!before) {
      await work.insertRows(pulls, {
        space_id: space,
        repo_id: repo.id,
        task_id: taskId,
        branch: input.branch,
        number: input.number,
        url: input.url,
        head_sha: input.headSha,
        checks: input.checks,
      });
    } else {
      const moved = before.head_sha !== input.headSha || before.number !== input.number;
      await work.updateRows(
        pulls,
        {
          number: input.number,
          url: input.url,
          head_sha: input.headSha,
          checks: input.checks,
          status: 'open',
          version: moved ? before.version + 1 : before.version,
          updated_at: Rule.now,
        },
        { id: before.id },
      );
    }
    return new PullOpenedView(
      (await work.row(pulls, { task_id: taskId, space_id: space })) as PullRow,
    );
  }
}

type GrantedInput = {
  approvalId: string;
  action: string;
  spaceId: string;
  targetId: string | null;
  targetVersion: number | null;
};

/**
 * task.approval.granted를 받으면 (코어가 돌림): code.pr.merge 결재면 결과를 남겨 작업을 끝낸다.
 * 4단계의 머지는 주인이 GitHub에서 직접 한다: 승인 = "머지했다". 결재한 판(PR version)이 지금과 다르면
 * (결재 뒤 다시 올림) 실패로 남긴다. 서버가 머지 · 확인하는 것은 6단계
 */
export class ConfirmMerge extends Command<GrantedInput> {
  readonly name = 'confirmMerge';
  readonly allow = Operation.SYSTEM;

  input(raw: unknown): GrantedInput {
    const r = (raw ?? {}) as { targetId?: unknown; targetVersion?: unknown };
    return this.fields(raw, (f) => ({
      approvalId: f.uuid('approvalId'),
      action: f.text('action', 100),
      spaceId: f.uuid('spaceId'),
      targetId: typeof r.targetId === 'string' ? f.uuid('targetId') : null,
      targetVersion:
        typeof r.targetVersion === 'number' ? f.integer('targetVersion', 0, VERSION_MAX) : null,
    }));
  }

  async run(work: Work, _actor: Actor, input: GrantedInput): Promise<ConfirmedView> {
    if (input.action !== MERGE_ACTION) return new ConfirmedView(false);
    const pull = input.targetId
      ? await work.row(pulls, { id: input.targetId, space_id: input.spaceId })
      : null;
    const problem = !pull
      ? '결재의 PR을 찾을 수 없어요'
      : pull.version !== input.targetVersion
        ? '결재한 뒤 PR이 바뀌었어요 (다시 올린 판을 결재해 주세요)'
        : null;
    if (pull && !problem)
      await work.updateRows(pulls, { status: 'merged', updated_at: Rule.now }, { id: pull.id });
    work.record(
      new DomainEvent('plugin.code_github.merge_confirmed', 1, input.spaceId, {
        approvalId: input.approvalId,
        outcome: problem ? 'failed' : 'done',
        ...(problem ? { error: problem } : {}),
      }),
    );
    return new ConfirmedView(true);
  }
}
