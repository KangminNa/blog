import type { Json } from './json';

/** 일의 대상 (글 등) */
export class JobTarget {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly version: number | null,
  ) {}
}

// next_jobs가 빌려 준 일 하나. run_token은 AI CLI의 MCP 설정에만 쓴다.
// 연결 확인(ai_test)에는 에이전트도 run_token도 없다. 도구는 작업의 payload에 있고, MCP 없이 지시만 돌린다.
export class Job {
  private static readonly AI_TEST = 'ai_test';

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
    );
  }

  /** 콘솔에 넣은 AI 토큰이 도는지 보는 일 */
  get isAiTest(): boolean {
    return this.kind === Job.AI_TEST;
  }

  /** AI CLI에게 줄 글. skillReady: 스킬을 넣어 두었는가 */
  prompt(skillReady: boolean): string {
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
    if (this.revisionNote) parts.push(`# 주인이 고쳐 달라고 한 말\n${this.revisionNote}`);
    if (this.skill && skillReady) parts.push(`# 스킬\n${this.skill} 스킬을 따릅니다.`);
    parts.push(
      [
        '# 일하는 법',
        '- 서버의 데이터는 cairn MCP 도구로만 읽고 씁니다.',
        '- 발행, 전송, 삭제는 직접 하지 않고 request_approval로 올린 뒤 바로 끝냅니다. 승인 뒤 실행은 서버가 합니다.',
      ].join('\n'),
    );
    return parts.join('\n\n');
  }
}
