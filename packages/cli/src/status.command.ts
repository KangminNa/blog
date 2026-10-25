import { join } from 'node:path';
import { AiTool } from './ai-tool';
import { SkillFolder, type SkillPackage } from './skill';
import type { Terminal } from './terminal';

// cairn status: 넣은 스킬의 버전과 올릴 곳·검토자·교차 검토, AI 도구에 등록된 cairn 서버와 상태.
export class StatusCommand {
  constructor(
    private readonly terminal: Terminal,
    private readonly tool: AiTool,
    private readonly skills: readonly SkillPackage[],
  ) {}

  async run(): Promise<void> {
    const t = this.terminal;
    t.say(`${this.tool.label}`);
    for (const skill of this.skills) {
      const marker = new SkillFolder(join(this.tool.skillsDir, skill.name)).marker();
      if (!marker) {
        t.say(`  스킬 ${skill.name}: 없음`);
        continue;
      }
      const newer =
        marker.version === skill.version
          ? ''
          : ` · 새 버전 ${skill.version} (cairn connect로 바꾸기)`;
      t.say(`  스킬 ${skill.name}: ${marker.version} · 올릴 곳 ${marker.site}${newer}`);
      t.say(`  검토자 ${marker.agents.length}명 · 교차 검토 ${marker.reviewWith ?? '없음'}`);
    }
    const version = await this.tool.version();
    if (!version) {
      t.say(`  명령(${this.tool.command})을 찾을 수 없음 · 설치: ${this.tool.install}`);
      return;
    }
    const bin = await this.tool.executable();
    if (bin !== this.tool.command) t.say(`  명령: ${bin} (PATH에 ${this.tool.command} 없음)`);
    const server = await this.tool.server();
    t.say(
      server
        ? `  MCP 서버 ${AiTool.SERVER}: ${server.url ?? '주소 모름'} · ${server.status}`
        : `  MCP 서버 ${AiTool.SERVER}: 등록 안 됨`,
    );
    if (server && !server.connected) t.say(`  로그인: ${await this.tool.loginCommand()}`);
  }
}
