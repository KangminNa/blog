import type { Json } from './json';

/** 일의 대상 (글 등) */
export class JobTarget {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly version: number | null,
  ) {}
}

/** 일을 맡길 수 있는 바로 아래 팀원 한 명 (위임) */
export class TeamMember {
  constructor(
    readonly agentId: string,
    readonly name: string,
    readonly role: string,
    readonly status: string,
    readonly kinds: readonly string[],
  ) {}

  static from(raw: Json): TeamMember {
    return new TeamMember(
      raw.text('agent_id'),
      raw.text('name'),
      raw.text('role'),
      raw.text('status'),
      raw.texts('kinds'),
    );
  }

  /** 지시문의 한 줄. 역할은 첫 줄만 */
  get line(): string {
    const role = this.role.split('\n')[0]?.trim();
    const paused = this.status === 'paused' ? ' (중지됨: 맡겨도 재개될 때까지 기다림)' : '';
    return `- ${this.name} (agent_id: ${this.agentId})${role ? `: ${role}` : ''} · 맡길 수 있는 일: ${this.kinds.join(', ')}${paused}`;
  }
}

/** 맡긴 하위 작업 하나의 결과. 하위 작업이 모두 끝나 깨어난 일에만 온다 */
export class SubtaskResult {
  private static readonly STATUS: Readonly<Record<string, string>> = {
    done: '완료',
    failed: '실패',
    cancelled: '취소',
  };

  constructor(
    readonly title: string,
    readonly agent: string,
    readonly status: string,
    readonly summary: string | null,
    readonly error: string | null,
  ) {}

  static from(raw: Json): SubtaskResult {
    return new SubtaskResult(
      raw.text('title'),
      raw.text('agent'),
      raw.text('status'),
      raw.optionalText('summary'),
      raw.optionalText('error'),
    );
  }

  get line(): string {
    const status = SubtaskResult.STATUS[this.status] ?? this.status;
    const body = this.error ?? this.summary ?? '결과 글 없음';
    return `## [${status}] ${this.title} (${this.agent || '담당 없음'})\n${body}`;
  }
}

/** 브라우저 작업(browse)의 사이트. 맡길 때의 값이 작업의 payload에 실려 온다 (browser-tabs 패키지) */
export class BrowseSite {
  constructor(
    /** 결재(request_approval)의 target_id · target_version으로 쓴다 */
    readonly id: string,
    readonly version: number,
    readonly name: string,
    readonly startUrl: string,
    /** 브라우저가 요청할 수 있는 출처 (Playwright MCP의 --allowed-origins) */
    readonly origins: readonly string[],
  ) {}

  /** 서버가 이미 걸렀지만 러너도 출처 모양만 본다: http(s)://호스트[:포트], 경로 없음 */
  static from(raw: Json): BrowseSite | null {
    const origins = raw.texts('origins').filter((o) => /^https?:\/\/[^/\s;]+$/i.test(o));
    if (origins.length === 0) return null;
    return new BrowseSite(
      raw.text('id'),
      raw.number('version'),
      raw.text('name'),
      raw.text('startUrl'),
      origins,
    );
  }

  /** 지시문의 한 단락 */
  get part(): string {
    return [
      `# 사이트: ${this.name}`,
      `사이트 id: ${this.id} · 판: ${this.version} (결재의 target_kind는 browser_site)`,
      `시작 주소: ${this.startUrl}`,
      `갈 수 있는 출처: ${this.origins.join(', ')}`,
      '브라우저는 playwright MCP 도구로 움직입니다. 이 출처 밖으로는 가지 않습니다.',
    ].join('\n');
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

  /** SKILL.md (스킬 폴더를 읽지 못하는 CLI에게 지시문으로 준다) */
  get skillMd(): string {
    return this.files.get(SkillPackage.ENTRY) ?? '';
  }
}

// next_jobs가 빌려 준 일 하나. run_token은 AI CLI의 MCP 설정에만 쓴다.
// 연결 확인(ai_test)과 웹 로그인(ai_signin)에는 에이전트도 run_token도 없다. 도구는 작업의 payload에 있고, MCP 없이 지시만 돌린다.
export class Job {
  private static readonly AI_TEST = 'ai_test';
  /** 웹 AI 로그인: 러너가 로그인 명령을 대신 돌린다 (SigninRun) */
  static readonly AI_SIGNIN = 'ai_signin';
  /** 서버 브라우저로 하는 일: 사이트(payload.site)가 실려 오고 Playwright MCP를 붙인다 */
  static readonly BROWSE = 'browse';
  /** 코드 작업: 코드 러너 칸에서 셸로 저장소를 고친다 (docs/코드작업.md) */
  static readonly CODE = 'code';

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
    /** 브라우저 작업의 사이트 (그 밖의 일은 null) */
    readonly site: BrowseSite | null = null,
    /** 코드 작업의 payload.code 그대로. 모양은 CodeSpec이 본다 (그 밖의 일은 null) */
    readonly codePayload: unknown = null,
    /** 코드 작업에서 AI에게 더 주는 단락 (저장소 · 고칠 곳 · 검사). CodeStage가 붙인다 */
    readonly brief: string | null = null,
    /** 서버가 실어 보낸 스킬 한 판. 옛 서버면 null (그때는 디스크의 skills/에서 이름으로 찾는다) */
    readonly skillPackage: SkillPackage | null = null,
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
      task.text('kind') === Job.BROWSE
        ? BrowseSite.from(task.child('payload').child('site'))
        : null,
      task.text('kind') === Job.CODE ? task.child('payload').field('code') : null,
      null,
      raw.field('skill_package') ? SkillPackage.from(raw.child('skill_package')) : null,
    );
  }

  /** 지시에 단락 하나를 더한 같은 일 (코드 작업의 저장소 단락) */
  withBrief(brief: string): Job {
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
      this.site,
      this.codePayload,
      brief,
      this.skillPackage,
    );
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

  /** 코드 러너 칸에서 하는 일 */
  get isCode(): boolean {
    return this.kind === Job.CODE;
  }

  /**
   * AI CLI에게 줄 글. skillReady: 스킬을 CLI의 스킬 폴더에 넣어 두었는가 (Claude).
   * skillText: 스킬 폴더를 읽지 못하는 CLI(셸이 없는 Codex)에게 지시문으로 넣을 SKILL.md.
   * outputsDir: 사람에게 줄 파일을 둘 폴더 (일이 잘 끝나면 러너가 결과물로 올린다)
   */
  prompt(
    skillReady: boolean,
    skillText: string | null = null,
    outputsDir: string | null = null,
  ): string {
    if (this.isAiTest) return this.instruction;
    const parts = [
      `당신은 Cairn의 에이전트 "${this.agentName}"입니다.${this.agentRole ? `\n${this.agentRole}` : ''}`,
      `# 할 일: ${this.title}\n${this.instruction}`,
    ];
    if (this.target) {
      const { kind, id, version } = this.target;
      const edition = version === null ? '' : `, 판 ${version}`;
      parts.push(`# 대상\n${kind} ${id}${edition}`);
    }
    if (this.goalChain.length > 0)
      parts.push(`# 목표\n${this.goalChain.join(' › ')}\n이 일은 위 목표를 위한 것입니다.`);
    if (this.revisionNote) parts.push(`# 주인이 고쳐 달라고 한 말\n${this.revisionNote}`);
    if (this.subtaskResults.length > 0)
      parts.push(
        [
          '# 맡긴 하위 작업의 결과',
          ...this.subtaskResults.map((r) => r.line),
          '',
          '결과를 모아 할 일을 마무리하고, 무엇을 했는지 짧게 보고하며 끝냅니다.',
        ].join('\n'),
      );
    if (this.site) parts.push(this.site.part);
    if (this.brief) parts.push(this.brief);
    if (this.team.length > 0) parts.push(this.teamPart());
    if (this.skill && skillReady) parts.push(`# 스킬\n${this.skill} 스킬을 따릅니다.`);
    else if (this.skill && skillText)
      parts.push(`# 스킬: ${this.skill}\n아래 스킬을 따릅니다.\n\n${skillText.trim()}`);
    parts.push(
      [
        '# 일하는 법',
        '- 서버의 데이터는 cairn MCP 도구로만 읽고 씁니다.',
        '- 발행, 전송, 삭제는 직접 하지 않고 request_approval로 올린 뒤 바로 끝냅니다. 승인 뒤 실행은 서버가 합니다.',
        ...(outputsDir
          ? [
              `- 사람에게 줄 파일(문서 · 슬라이드 · 표 · 그림 · 영상)을 만들면 ${outputsDir} 바로 아래에 둡니다. 일이 잘 끝나면 그 폴더의 파일만 결과물로 주인에게 갑니다 (하나 100MB, 200개까지. 폴더 · 숨김 파일은 빠집니다).`,
            ]
          : []),
      ].join('\n'),
    );
    return parts.join('\n\n');
  }

  /** 내 팀과 위임하는 법. 맡길지는 AI가 정하고, 받는 쪽 · 종류 · 한도는 서버가 막는다 */
  private teamPart(): string {
    const how =
      this.roundsLeft > 0
        ? [
            '나눠 맡기는 편이 나을 때만 delegate_task로 한 번에 맡기고, 이 실행은 바로 끝냅니다.',
            '팀원은 내가 쓴 지시와 목표만 보고 일하므로 지시에 필요한 것을 모두 적습니다.',
            `하위 작업이 모두 끝나면 결과와 함께 이 일이 다시 옵니다. 남은 위임 횟수: ${this.roundsLeft}.`,
          ]
        : ['더 맡길 수 없습니다. 직접 마무리합니다.'];
    return ['# 내 팀 (바로 아래)', ...this.team.map((m) => m.line), '', ...how].join('\n');
  }
}
