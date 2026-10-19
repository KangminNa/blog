import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// 스킬은 이 명령에 함께 들어 있는 것만 넣는다 (블로그에서 받지 않는다).
// 스킬에는 실행되는 스크립트와 "묻지 않고 허락" 목록(allowed-tools)이 있어서, 연결한 블로그가 보낸 스킬을 넣으면
// 그 블로그가 이 컴퓨터에서 코드를 돌릴 수 있게 되기 때문이다. 도구의 입력 모양은 AI가 MCP 서버에서 직접 받는다.

/**
 * 스킬 하나의 파일 묶음 (저장소의 skills/<이름>/). 점으로 시작하는 파일은 넣지 않는다.
 * agents/<도구>/ 아래는 스킬 폴더가 아니라 그 도구의 하위 에이전트(검토자) 폴더에 들어간다.
 */
export class SkillPackage {
  constructor(
    readonly name: string,
    /** 스킬 폴더 기준 경로 → 내용 (agents/ 포함) */
    readonly files: ReadonlyMap<string, string>,
  ) {}

  static load(dir: string): SkillPackage {
    const files = new Map<string, string>();
    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : 1,
      )) {
        if (entry.name.startsWith('.')) continue;
        const path = join(at, entry.name);
        if (entry.isDirectory()) walk(path);
        else files.set(relative(dir, path).split('\\').join('/'), readFileSync(path, 'utf8'));
      }
    };
    walk(dir);
    return new SkillPackage(dir.split(/[/\\]/).pop() ?? '', files);
  }

  /** 이 명령에 함께 든 스킬 전부. 저장소에서는 <저장소>/skills, 배포한 패키지에서는 <패키지>/skills */
  static bundled(): SkillPackage[] {
    const dir = [join(__dirname, '../skills'), join(__dirname, '../../../skills')].find((d) =>
      existsSync(d),
    );
    if (!dir) return [];
    return readdirSync(dir)
      .filter((name) => existsSync(join(dir, name, 'SKILL.md')))
      .sort()
      .map((name) => SkillPackage.load(join(dir, name)));
  }

  /** 스킬 폴더에 넣을 파일 (agents/ 빼고) */
  get skillFiles(): ReadonlyMap<string, string> {
    return new Map([...this.files].filter(([path]) => !path.startsWith('agents/')));
  }

  /** 그 도구의 검토자 정의: 파일 이름 → 내용 (skills/<이름>/agents/<도구>/) */
  agents(kind: string): ReadonlyMap<string, string> {
    const prefix = `agents/${kind}/`;
    return new Map(
      [...this.files]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, text]) => [path.slice(prefix.length), text]),
    );
  }

  /** 내용의 해시 앞 12자리. 스킬을 고치면 저절로 바뀐다 */
  get version(): string {
    const hash = createHash('sha256');
    for (const [path, text] of this.files) hash.update(`${path}\n${text}\n`);
    return hash.digest('hex').slice(0, 12);
  }
}

/**
 * 넣은 스킬에 남기는 표시 (.cairn.json). 이 파일이 있으면 cairn connect가 넣은 폴더다.
 * 스킬의 스크립트가 site(미리보기의 올릴 곳)·tool·review_with(교차 검토 명령줄)를 읽는다.
 */
export class SkillMarker {
  static readonly FILE = '.cairn.json';

  constructor(
    readonly version: string,
    readonly site: string,
    readonly mcp: string,
    readonly tool: string,
    /** 교차 검토에 쓸 다른 AI 명령줄 (claude · codex · gemini), 없으면 null */
    readonly reviewWith: string | null,
    /** 넣은 검토자 파일 (다시 넣거나 지울 때 이 명령이 넣은 것만 건드린다) */
    readonly agents: readonly string[],
  ) {}

  static read(dir: string): SkillMarker | null {
    try {
      const raw = JSON.parse(readFileSync(join(dir, SkillMarker.FILE), 'utf8')) as Record<
        string,
        unknown
      >;
      return new SkillMarker(
        String(raw.version ?? ''),
        String(raw.site ?? ''),
        String(raw.mcp ?? ''),
        String(raw.tool ?? ''),
        typeof raw.review_with === 'string' ? raw.review_with : null,
        Array.isArray(raw.agents) ? raw.agents.map(String) : [],
      );
    } catch {
      return null;
    }
  }

  toJSON(): object {
    return {
      version: this.version,
      site: this.site,
      mcp: this.mcp,
      tool: this.tool,
      review_with: this.reviewWith,
      agents: this.agents,
    };
  }
}

/** AI 도구의 스킬 폴더 안의 한 자리 (예: ~/.claude/skills/cairn-save) */
export class SkillFolder {
  constructor(readonly dir: string) {}

  get exists(): boolean {
    return existsSync(this.dir);
  }

  marker(): SkillMarker | null {
    return SkillMarker.read(this.dir);
  }

  /** 지금 내용을 지우고 스킬(render로 도구에 맞게 고친 것)과 표시를 새로 쓴다 */
  write(
    files: ReadonlyMap<string, string>,
    marker: SkillMarker,
    render: (path: string, text: string) => string,
  ): void {
    rmSync(this.dir, { recursive: true, force: true });
    for (const [path, text] of files) {
      const to = join(this.dir, path);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, render(path, text));
    }
    writeFileSync(join(this.dir, SkillMarker.FILE), `${JSON.stringify(marker, null, 2)}\n`);
  }
}
