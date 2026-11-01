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
export class Job {
  constructor(
    readonly taskId: string,
    readonly title: string,
    readonly instruction: string,
    readonly target: JobTarget | null,
    readonly skill: string | null,
    readonly revisionNote: string | null,
    readonly agentName: string,
    readonly agentRole: string,
    readonly agentTool: string,
    readonly runToken: string,
    readonly leaseUntil: Date | null,
  ) {}

  static from(raw: Json): Job {
    const task = raw.child('task');
    const agent = raw.child('agent');
    const target = raw.child('target');
    const lease = task.optionalText('lease_until');
    return new Job(
      task.text('id'),
      task.text('title'),
      raw.text('instruction'),
      target.optionalText('kind') === null
        ? null
        : new JobTarget(target.text('kind'), target.text('id'), target.optionalNumber('version')),
      raw.optionalText('skill'),
      raw.optionalText('revision_note'),
      agent.text('name'),
      agent.text('role'),
      agent.text('tool'),
      raw.text('run_token'),
      lease === null ? null : new Date(lease),
    );
  }

  /** AI CLI에게 줄 글. skillReady: 스킬을 넣어 두었는가 */
  prompt(skillReady: boolean): string {
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
