import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiTool } from './ai-tool';
import { CairnSite, type SiteAddress } from './cairn-site';
import { SkillFolder, SkillMarker, type SkillPackage } from './skill';
import { CliError, type Terminal } from './terminal';

/** 교차 검토에 쓸 수 있는 다른 AI 명령줄 */
export const REVIEWERS = ['claude', 'codex', 'gemini'] as const;

// cairn connect <블로그 주소>: 블로그 확인 → AI 도구 찾기 → 스킬·검토자 넣기 → MCP 등록 → 로그인 → 연결 확인.
// 이미 된 단계는 건너뛰므로 여러 번 불러도 된다 (스킬을 새 버전으로 바꿀 때도 이것을 다시 부른다).
export class ConnectCommand {
  constructor(
    private readonly terminal: Terminal,
    private readonly tool: AiTool,
    private readonly skills: readonly SkillPackage[],
    /** 교차 검토 명령줄 (--review-with). null이면 지난번 값을 그대로 둔다 */
    private readonly reviewWith: string | null = null,
  ) {}

  async run(input: string): Promise<void> {
    const t = this.terminal;
    const site = CairnSite.parse(input);
    const at = await site.address();
    if (at.site !== site.origin) t.say(`사이트 주소 기준으로 연결해요: ${at.site}`);
    t.done(`Cairn 블로그 · ${at.mcp}`);

    const version = await this.tool.version();
    if (!version)
      throw new CliError(
        `${this.tool.label} 명령(${this.tool.command})을 찾을 수 없어요. 설치: ${this.tool.install}`,
      );
    t.done(`${this.tool.label} ${version}`);

    if (this.skills.length === 0) throw new CliError('함께 든 스킬이 없어요 (설치가 망가졌어요)');
    for (const skill of this.skills) await this.install(skill, at);

    const before = await this.tool.server();
    if (before?.url === at.mcp) t.done(`MCP 서버 ${AiTool.SERVER} · 이미 등록됨`);
    else {
      if (before) {
        const swap = await t.confirm(
          `다른 블로그(${before.url ?? '알 수 없는 주소'})에 연결돼 있어요. ${at.site}로 바꿀까요?`,
        );
        if (!swap) throw new CliError('연결을 바꾸지 않았어요');
        await this.tool.removeServer();
      }
      await this.tool.addServer(at.mcp);
      t.done(`MCP 서버 ${AiTool.SERVER} 등록 (모든 프로젝트)`);
    }

    if (!(before?.url === at.mcp && before.connected)) {
      t.say(
        '브라우저가 열리면 블로그에 로그인하고, 기기 이름·권한을 확인한 뒤 "연결"을 눌러 주세요.',
      );
      if (!(await this.tool.login()))
        throw new CliError(
          `로그인을 마치지 못했어요. ${this.tool.label}에서 /mcp → cairn으로 다시 할 수 있어요`,
        );
    }

    if (this.tool.confirmsConnection) {
      const after = await this.tool.server();
      if (!after?.connected)
        throw new CliError(
          `연결을 확인하지 못했어요 (${after?.status ?? '등록 안 됨'}). ${this.tool.label}에서 /mcp로 cairn 상태를 봐 주세요`,
        );
      t.done('연결됨');
    } else t.done(`로그인 끝 · ${this.tool.label}에서 /mcp로 cairn이 연결됐는지 한 번 봐 주세요`);
    t.say();
    t.say(`작업을 마치면 ${this.tool.label}에서 "이 세션 저장해" 또는 /cairn-save`);
  }

  /** 스킬 하나와 그 검토자들을 넣는다. 이 명령이 넣지 않은 같은 이름의 폴더·파일이 있으면 묻는다 */
  private async install(skill: SkillPackage, at: SiteAddress): Promise<void> {
    const folder = new SkillFolder(join(this.tool.skillsDir, skill.name));
    const marker = folder.marker();
    if (folder.exists && !marker) {
      const overwrite = await this.terminal.confirm(
        `${folder.dir}에 같은 이름의 스킬이 있어요. 덮어쓸까요?`,
      );
      if (!overwrite) throw new CliError(`스킬 ${skill.name}을 넣지 않았어요`);
    }
    const reviewWith = this.reviewWith ?? marker?.reviewWith ?? null;
    const agents = await this.installAgents(skill, marker?.agents ?? []);
    if (
      marker?.version === skill.version &&
      marker.site === at.site &&
      marker.tool === this.tool.id &&
      marker.reviewWith === reviewWith
    ) {
      this.terminal.done(`스킬 ${skill.name} · 이미 최신`);
      return;
    }
    folder.write(
      skill.skillFiles,
      new SkillMarker(skill.version, at.site, at.mcp, this.tool.id, reviewWith, agents),
      (path, text) =>
        path === 'SKILL.md' || path.endsWith('.md')
          ? this.tool.renderSkill(text, folder.dir)
          : text,
    );
    this.terminal.done(
      `스킬 ${skill.name} 넣음 · ${folder.dir}${reviewWith ? ` · 교차 검토 ${reviewWith}` : ''}`,
    );
  }

  /** 검토자(하위 에이전트) 정의를 도구의 폴더에 넣고, 넣은 파일 경로를 돌려준다 */
  private async installAgents(skill: SkillPackage, managed: readonly string[]): Promise<string[]> {
    const written: string[] = [];
    for (const [file, text] of skill.agents(this.tool.agentKind)) {
      const to = join(this.tool.agentsDir, file);
      const ours = managed.includes(to);
      if (existsSync(to) && !ours && readFileSync(to, 'utf8') !== text) {
        const overwrite = await this.terminal.confirm(
          `${to}에 같은 이름의 에이전트가 있어요. 덮어쓸까요?`,
        );
        if (!overwrite) continue;
      }
      mkdirSync(this.tool.agentsDir, { recursive: true });
      writeFileSync(to, text);
      written.push(to);
    }
    if (written.length) this.terminal.done(`검토자 ${written.length}명 · ${this.tool.agentsDir}`);
    return written;
  }
}
