import type { BrowsePlan } from './browser-mcp';
import { ChatTurn } from './chat-turn';
import type { Json } from './json';
import type { PromptPack } from './prompt-pack';
import { TeamMember } from './team-member';

/** 일의 대상 (글 등) */
export class JobTarget {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly version: number | null,
  ) {}
}

/** 맡긴 하위 작업 하나의 결과. 하위 작업이 모두 끝나 깨어난 일에만 온다 */
export class SubtaskResult {
  /** 틀(subtask)이 이름을 아는 상태. 그 밖의 상태는 값 그대로 */
  private static readonly KNOWN: readonly string[] = ['done', 'failed', 'cancelled'];

  constructor(
    readonly title: string,
    readonly agent: string,
    readonly status: string,
    readonly summary: string | null,
    readonly error: string | null,
    /** 그 작업이 만든 결과물 (이름 · id). 보고(report_round)의 근거로 output_id를 건다 */
    readonly outputs: readonly string[] = [],
  ) {}

  static from(raw: Json): SubtaskResult {
    return new SubtaskResult(
      raw.text('title'),
      raw.text('agent'),
      raw.text('status'),
      raw.optionalText('summary'),
      raw.optionalText('error'),
      raw.list('outputs').map((o) => `${o.text('name')} (output_id: ${o.text('id')})`),
    );
  }

  /** 지시문의 한 덩이 (틀 subtask) */
  line(prompts: PromptPack): string {
    return prompts.fill('subtask', {
      done: this.status === 'done',
      failed: this.status === 'failed',
      cancelled: this.status === 'cancelled',
      other: SubtaskResult.KNOWN.includes(this.status) ? null : this.status,
      title: this.title,
      agent: this.agent,
      body: this.error ?? this.summary,
      outputs: this.outputs.join(', '),
    });
  }
}

/**
 * 서버가 실어 보낸 스킬 한 판 (next_jobs의 skill_package). 러너는 디스크의 skills/ 대신 이것으로 깐다:
 * 콘솔에서 고친 판이 배포 없이 바로 쓰이고, 어느 러너든 같은 판으로 돈다.
 * 서버가 걸렀지만 러너도 경로 모양을 본다 (스킬 폴더 밖에 쓰지 않게). 틀리면 스킬이 없는 것으로 본다
 */
export class SkillPackage {
  static readonly ENTRY = 'SKILL.md';
  private static readonly NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
  private static readonly PATH = /^(SKILL\.md|references\/[a-z0-9][a-z0-9._-]{0,60}\.md)$/;

  private constructor(
    readonly name: string,
    /** repo(저장소 판) · console(콘솔 판) */
    readonly source: string,
    readonly revision: number | null,
    readonly hash: string,
    readonly files: ReadonlyMap<string, string>,
  ) {}

  static from(raw: Json): SkillPackage | null {
    const name = raw.text('name');
    const files = raw.field('files');
    if (!SkillPackage.NAME.test(name) || typeof files !== 'object' || files === null) return null;
    const entries = Object.entries(files as Record<string, unknown>);
    const ok = entries.every(
      ([path, text]) => SkillPackage.PATH.test(path) && typeof text === 'string',
    );
    if (!ok || !entries.some(([path]) => path === SkillPackage.ENTRY)) return null;
    return new SkillPackage(
      name,
      raw.text('source'),
      raw.optionalNumber('revision'),
      raw.text('hash'),
      new Map(entries as [string, string][]),
    );
  }

  /** 로그에 남기는 판: 콘솔 판 N (해시 앞 7자) · 저장소 판 (해시 앞 7자) */
  get label(): string {
    const where = this.source === 'console' ? `콘솔 판 ${this.revision}` : '저장소 판';
    return `${where} (${this.hash.slice(0, 7)})`;
  }

  /** SKILL.md (스킬 폴더를 읽지 못하는 CLI에게 지시문으로 준다) */
  get skillMd(): string {
    return this.files.get(SkillPackage.ENTRY) ?? '';
  }
}

// next_jobs가 빌려 준 일 하나. run_token은 AI CLI의 MCP 설정에만 쓴다.
// 연결 확인(ai_test) · 웹 로그인(ai_signin) · 대화의 배정(chat_route)에는 에이전트도 run_token도 없다.
// 도구는 작업의 payload에 있고, MCP 없이 지시만 돌린다.
export class Job {
  private static readonly AI_TEST = 'ai_test';
  /** 대화의 배정 (2차 1-5): 서버가 채운 지시(지시문 틀 chat-route) 하나를 그대로 돌리고 답(JSON 한 줄)을 낸다 */
  private static readonly ROUTE = 'chat_route';
  /** 웹 AI 로그인: 러너가 로그인 명령을 대신 돌린다 (SigninRun) */
  static readonly AI_SIGNIN = 'ai_signin';
  /** 서버 브라우저로 하는 일: 어디서 돌지는 러너가 browser_job으로 받고(BrowseStage) Playwright MCP를 붙인다 */
  static readonly BROWSE = 'browse';
  /** 코드 작업: 코드 러너 칸에서 셸로 저장소를 고친다 (docs/코드작업.md) */
  static readonly CODE = 'code';
  /** 만들기 작업: 코드 러너 칸에서 셸로 PPT · 문서 · 영상을 만든다 (결과물 2차) */
  static readonly MAKE = 'make';

  constructor(
    readonly taskId: string,
    readonly kind: string,
    readonly title: string,
    readonly instruction: string,
    readonly target: JobTarget | null,
    readonly skill: string | null,
    readonly revisionNote: string | null,
    readonly agentName: string,
    readonly agentRole: string,
    /** 일을 돌릴 AI 도구 */
    readonly tool: string,
    readonly runToken: string | null,
    readonly leaseUntil: Date | null,
    /** 회사 목표부터 이 일의 목표까지 (제목) */
    readonly goalChain: readonly string[] = [],
    /** 바로 아래 팀. 있으면 delegate_task로 일을 나눠 맡길 수 있다 */
    readonly team: readonly TeamMember[] = [],
    /** 맡긴 하위 작업의 결과 (깨어난 일) */
    readonly subtaskResults: readonly SubtaskResult[] = [],
    /** 앞으로 위임할 수 있는 횟수 */
    readonly roundsLeft = 0,
    /** 브라우저 작업이 도는 곳 (BrowseStage가 붙인다. 그 밖의 일은 null) */
    readonly browse: BrowsePlan | null = null,
    /** 코드 작업의 payload.code 그대로. 모양은 CodeSpec이 본다 (그 밖의 일은 null) */
    readonly codePayload: unknown = null,
    /** 코드 작업에서 AI에게 더 주는 단락 (저장소 · 고칠 곳 · 검사). CodeStage가 붙인다 */
    readonly brief: string | null = null,
    /** 서버가 실어 보낸 스킬 한 판. 옛 서버면 null (그때는 디스크의 skills/에서 이름으로 찾는다) */
    readonly skillPackage: SkillPackage | null = null,
    /** 만들기 작업의 payload.make 그대로 (재료). 모양은 MakeMaterials가 본다 (그 밖의 일은 null) */
    readonly makePayload: unknown = null,
    /** 결과를 페이지로 내보내는 만들기 작업인가 (payload.page). 문(index.html)을 만들어야 하고 웹 검색을 쓴다 */
    readonly page = false,
    /** 대화의 회차 (payload.chat): 앞 대화와 답하는 법. 그 밖의 일은 null */
    readonly chat: ChatTurn | null = null,
    /** 이 러너에 묶인 에이전트의 일 (서버가 알린다). 이때만 이 러너가 나눈 폴더를 연다 (SharedFolders) */
    readonly bound = false,
    /** 서버가 실어 보낸 지시문 틀(cairn-runner)의 지금 판. 옛 서버면 null (그때는 러너의 skills/) */
    readonly promptPackage: SkillPackage | null = null,
  ) {}

  static from(raw: Json): Job {
    const task = raw.child('task');
    const agent = raw.child('agent');
    const target = raw.child('target');
    const lease = task.optionalText('lease_until');
    return new Job(
      task.text('id'),
      task.text('kind'),
      task.text('title'),
      raw.text('instruction'),
      target.optionalText('kind') === null
        ? null
        : new JobTarget(target.text('kind'), target.text('id'), target.optionalNumber('version')),
      raw.optionalText('skill'),
      raw.optionalText('revision_note'),
      agent.text('name'),
      agent.text('role'),
      agent.text('tool') || task.child('payload').text('tool'),
      raw.optionalText('run_token'),
      lease === null ? null : new Date(lease),
      raw
        .list('goal_chain')
        .map((g) => g.text('title'))
        .filter(Boolean),
      raw.list('team').map((m) => TeamMember.from(m)),
      raw.list('subtask_results').map((r) => SubtaskResult.from(r)),
      raw.number('rounds_left'),
      null,
      task.text('kind') === Job.CODE ? task.child('payload').field('code') : null,
      null,
      raw.field('skill_package') ? SkillPackage.from(raw.child('skill_package')) : null,
      task.text('kind') === Job.MAKE ? (task.child('payload').field('make') ?? null) : null,
      task.text('kind') === Job.MAKE && Boolean(task.child('payload').field('page')),
      ChatTurn.from(
        task.child('payload'),
        raw.field('chat_updates') ? raw.child('chat_updates') : null,
      ),
      agent.flag('bound'),
      raw.field('prompt_package') ? SkillPackage.from(raw.child('prompt_package')) : null,
    );
  }

  /** 지시에 단락 하나를 더한 같은 일 (코드 작업의 저장소 단락, 만들기 작업의 재료 단락) */
  withBrief(brief: string): Job {
    return this.withBrowse(this.browse, brief);
  }

  /** 브라우저 작업이 도는 곳과 그 단락(사이트 · 둘러보기)을 더한 같은 일 (BrowseStage) */
  withBrowse(browse: BrowsePlan | null, brief: string): Job {
    return new Job(
      this.taskId,
      this.kind,
      this.title,
      this.instruction,
      this.target,
      this.skill,
      this.revisionNote,
      this.agentName,
      this.agentRole,
      this.tool,
      this.runToken,
      this.leaseUntil,
      this.goalChain,
      this.team,
      this.subtaskResults,
      this.roundsLeft,
      browse,
      this.codePayload,
      brief,
      this.skillPackage,
      this.makePayload,
      this.page,
      this.chat,
      this.bound,
      this.promptPackage,
    );
  }

  /** 이 일에 나눠 줄 폴더: 이 러너에 묶인 에이전트의 일에만 (아무 에이전트나 내 파일을 보지 않게). 칸의 일은 늘 없음 */
  sharedFolders<T>(folders: T | null): T | null {
    return this.bound && !this.sandboxed ? folders : null;
  }

  /** 콘솔에 넣은 AI 토큰이 도는지 보는 일 */
  get isAiTest(): boolean {
    return this.kind === Job.AI_TEST;
  }

  /** 주인이 웹에서 누른 AI 로그인. 도구(tool)는 작업의 payload에 있다 */
  get isAiSignin(): boolean {
    return this.kind === Job.AI_SIGNIN;
  }

  /** 서버 브라우저로 하는 일 */
  get isBrowse(): boolean {
    return this.kind === Job.BROWSE;
  }

  /** 저장소를 고치는 일 (코드 러너 칸) */
  get isCode(): boolean {
    return this.kind === Job.CODE;
  }

  /** 파일을 만드는 일 (코드 러너 칸) */
  get isMake(): boolean {
    return this.kind === Job.MAKE;
  }

  /** 셸이 있는 코드 러너 칸에서만 하는 일 (서버의 Task.SANDBOXED와 같다) */
  get sandboxed(): boolean {
    return this.isCode || this.isMake;
  }

  /**
   * AI CLI에게 줄 글. 글은 지시문 틀(prompts, 러너 스킬 cairn-runner)에서 오고, 여기서는 어느 단락을 어떤 순서로 넣을지만 정한다.
   * skillReady: 스킬을 CLI의 스킬 폴더에 넣어 두었는가 (Claude).
   * skillText: 스킬 폴더를 읽지 못하는 CLI(셸이 없는 Codex)에게 지시문으로 넣을 SKILL.md.
   * outputsDir: 사람에게 줄 파일을 둘 폴더 (일이 잘 끝나면 러너가 결과물로 올린다)
   */
  prompt(
    prompts: PromptPack,
    skillReady: boolean,
    skillText: string | null = null,
    outputsDir: string | null = null,
  ): string {
    if (this.isAiTest || this.kind === Job.ROUTE) return this.instruction;
    const parts = [
      prompts.fill('intro', { agent: this.agentName, role: this.agentRole }),
      prompts.fill('task', { title: this.title, instruction: this.instruction }),
    ];
    if (this.chat) parts.push(this.chat.part(prompts));
    if (this.target) {
      const { kind, id, version } = this.target;
      parts.push(
        prompts.fill('target', { kind, id, version: version === null ? null : String(version) }),
      );
    }
    if (this.goalChain.length > 0)
      parts.push(prompts.fill('goal', { chain: this.goalChain.join(' › ') }));
    if (this.revisionNote) parts.push(prompts.fill('revision', { note: this.revisionNote }));
    if (this.subtaskResults.length > 0)
      parts.push(
        prompts.fill('subtasks', {
          results: this.subtaskResults.map((r) => r.line(prompts)).join('\n'),
        }),
      );
    if (this.brief) parts.push(this.brief);
    if (this.team.length > 0)
      parts.push(
        prompts.fill('team', {
          members: this.team.map((m) => m.line(prompts)).join('\n'),
          rounds: this.roundsLeft,
        }),
      );
    if (this.skill && skillReady) parts.push(prompts.fill('skill', { name: this.skill }));
    else if (this.skill && skillText)
      parts.push(prompts.fill('skill', { name: this.skill, text: skillText.trim() }));
    parts.push(prompts.fill('work', { outputs: outputsDir, browse: this.isBrowse }));
    return parts.join('\n\n');
  }
}
