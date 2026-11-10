import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 플러그인 목록 파일(cairn-plugin.json). 플러그인이 무엇을 쓰는지 여기에 적힌 것만 허락된다.
// 서버를 시작할 때 들어 있는 플러그인을 모두 읽고 검사한다. 틀리면 시작하지 않는다.

/** 플러그인이 지원하는 Cairn 플러그인 API 버전 */
const CAIRN_PLUGIN_API = '0.3';

/** 웹 화면 자리. 늘릴 때는 웹의 <Slot>과 문서를 함께 고친다 */
const WEB_SLOTS: readonly string[] = ['post.after', 'task.office'];

/**
 * 서버 확장 지점. 목록 파일의 `uses`에 적고, 켤 때 주인이 허락한 것만 PluginContext가 열어 준다.
 *   event:<무늬>  이벤트 받기 (예: event:blog.post.*)
 *   job:<이름>    일꾼이 간격마다 돌리는 일
 *   action:<이름> 주인이 누르는 동작
 *   archive:read  보관 형식 파일 읽기 (vault 비공개 내용 포함)
 *   archive:restore  보관 형식 파일을 빈 Cairn에 들여오기
 *   login:<이름>  로그인 방법 (예: login:github). 주인이 연결해 둔 계정으로만 로그인된다
 * 기능 패키지 (2026-11-08): 코어를 고치지 않고 자기 표 · API · MCP 도구 · 콘솔 메뉴를 갖는다
 *   table         자기 스키마(목록 파일 schema)에 표를 만들고 쓴다. 다른 스키마에는 쓰지 않는다
 *   api           목록 파일 api의 경로를 연다 (/api/p/<이름>/…)
 *   tool:<이름>   MCP 도구를 연다 (목록 파일 tools)
 *   menu          콘솔 메뉴와 화면을 더한다 (목록 파일 menu)
 *   task:request  동작이 task.task.requested 이벤트로 에이전트에게 일을 맡긴다
 */
const USES = [
  /^table$/,
  /^api$/,
  /^tool:[a-z][a-z0-9_]*$/,
  /^menu$/,
  /^task:request$/,
  /^event:[a-z*][a-z_.*]*$/,
  /^job:[a-z][a-z0-9-]*$/,
  /^action:[a-z][a-z0-9-]*$/,
  /^archive:(?:read|restore)$/,
  /^login:[a-z][a-z0-9-]*$/,
];

const SETTING_TYPES = ['text', 'secret', 'select', 'boolean'];

/** 코어 모듈의 스키마. 기능 패키지는 이 이름을 쓸 수 없다 (apps/server/modules.json) */
const CORE_SCHEMAS = ['public', 'platform', 'account', 'vault', 'blog', 'work', 'task', 'mcp'];

/** 기능 패키지의 MCP 도구 하나 (목록 파일 tools의 한 항목) */
export interface PackageToolSpec {
  /** 부를 동작 이름 (서버 파일이 cairn.addOperation으로 등록) */
  readonly operation: string;
  /** AI가 언제 이 도구를 쓸지 판단할 설명 */
  readonly description: string;
  /** 입력 모양 (JSON Schema의 properties · required) */
  readonly input: Readonly<Record<string, unknown>>;
}

/** 기능 패키지의 콘솔 메뉴 (목록 파일 menu) */
export interface PackageMenu {
  /** 콘솔 메뉴의 그룹 (예: 운영) */
  readonly group: string;
  readonly name: string;
  readonly icon: string;
  /** 콘솔 화면 파일 (web/ 안) */
  readonly page: string;
}

/** 설정 항목 하나. 설치 마법사·관리 화면의 칸이 이것으로 만들어진다 */
export class PluginSettingSpec {
  constructor(
    readonly key: string,
    readonly label: string,
    readonly type: string,
    readonly required: boolean,
    readonly help: string,
    readonly defaultValue: string,
    readonly options: readonly string[],
    readonly isPublic: boolean,
  ) {}

  get isSecret(): boolean {
    return this.type === 'secret';
  }

  /** 넣으려는 값의 문제. 없으면 null */
  problemWith(value: string): string | null {
    if (value === '') return this.required ? `${this.label}: 꼭 넣어 주세요` : null;
    if (value.length > 2000) return `${this.label}: 너무 길어요`;
    if (this.type === 'boolean' && value !== 'true' && value !== 'false') {
      return `${this.label}: true 또는 false로 넣어 주세요`;
    }
    if (this.type === 'select' && !this.options.includes(value)) {
      return `${this.label}: ${this.options.join(', ')} 중 하나로 넣어 주세요`;
    }
    return null;
  }
}

export class PluginManifest {
  private static readonly NAME = /^[a-z][a-z0-9-]{1,39}$/;
  private static readonly VERSION = /^\d+\.\d+\.\d+$/;
  private static readonly KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;

  private constructor(
    readonly dir: string,
    readonly name: string,
    readonly version: string,
    readonly description: string,
    readonly settings: readonly PluginSettingSpec[],
    readonly webSlots: ReadonlyMap<string, string>,
    readonly server: string | null,
    readonly uses: ReadonlySet<string>,
    /** 기능 패키지의 자기 스키마 (migrations/의 SQL이 만든다). 없으면 표가 없다 */
    readonly schema: string | null = null,
    /** "GET /reads" → 동작 이름. /api/p/<이름>/reads로 열린다 */
    readonly api: ReadonlyMap<string, string> = new Map(),
    /** MCP 도구 이름 → 도구 */
    readonly tools: ReadonlyMap<string, PackageToolSpec> = new Map(),
    readonly menu: PackageMenu | null = null,
  ) {}

  /** 확장 지점을 켜는 사람이 읽을 말로 (설치 마법사·관리 화면·명령줄이 함께 씀) */
  static describeUse(use: string): string {
    const [kind, arg] = [use.slice(0, use.indexOf(':')), use.slice(use.indexOf(':') + 1)];
    if (use === 'archive:restore') return '보관 파일을 빈 Cairn에 들여와요';
    if (kind === 'archive') return '블로그와 vault의 모든 내용(비공개 포함)을 읽어요';
    if (kind === 'event') return `"${arg}" 이벤트가 생기면 받아요`;
    if (kind === 'job') return `일꾼이 정해진 간격마다 "${arg}" 작업을 돌려요`;
    if (kind === 'action') return `관리 동작 "${arg}"을(를) 추가해요`;
    if (kind === 'login')
      return `로그인 방법 "${arg}"을(를) 더해요 (계정 화면에서 연결해 둔 계정으로만 로그인돼요)`;
    if (use === 'table') return '자기 스키마에 표를 만들고 써요 (배포할 때 마이그레이션이 돌아요)';
    if (use === 'api') return 'API 경로를 열어요 (/api/p/<이름>/…)';
    if (kind === 'tool') return `MCP 도구 "${arg}"을(를) AI에게 열어요`;
    if (use === 'menu') return '콘솔에 메뉴와 화면을 더해요';
    if (use === 'task:request') return 'AI 에이전트에게 작업을 맡겨요 (결재는 그대로 주인에게)';
    return use;
  }

  allows(use: string): boolean {
    return this.uses.has(use);
  }

  /**
   * 동작이 남길 수 있는 이벤트 이름. 자기 이름(plugin.<스키마>.<무엇>)은 늘,
   * 코어의 이벤트는 그 확장 지점을 허락받았을 때만 (task:request → task.task.requested)
   */
  emits(name: string): boolean {
    if (this.schema && name.startsWith(`plugin.${this.schema}.`)) return true;
    return name === 'task.task.requested' && this.allows('task:request');
  }

  setting(key: string): PluginSettingSpec | null {
    return this.settings.find((s) => s.key === key) ?? null;
  }

  /** 켤 때 허락받은 확장 지점 밖의 것을 새로 쓰는가 (버전이 올라 더 달라는 경우) */
  needsGrant(granted: ReadonlySet<string>): readonly string[] {
    return [...this.uses].filter((u) => !granted.has(u));
  }

  /** 플러그인 폴더에서 cairn-plugin.json을 읽고 검사한다. 문제가 있으면 모두 모아 한 번에 알린다 */
  static read(dir: string): PluginManifest {
    const file = join(dir, 'cairn-plugin.json');
    if (!existsSync(file)) throw new Error(`플러그인 목록 파일이 없어요: ${file}`);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`${file}을 JSON으로 읽을 수 없어요: ${(e as Error).message}`);
    }
    const problems: string[] = [];
    const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');

    const name = str('name');
    if (!PluginManifest.NAME.test(name)) problems.push('name은 소문자·숫자·하이픈 2~40자여야 해요');
    if (!PluginManifest.VERSION.test(str('version'))) {
      problems.push('version은 1.2.3 형식이어야 해요');
    }
    if (!PluginManifest.supports(str('cairn'))) {
      problems.push(
        `cairn 범위("${str('cairn')}")가 지금 플러그인 API ${CAIRN_PLUGIN_API}와 맞지 않아요`,
      );
    }

    const settings: PluginSettingSpec[] = [];
    const rawSettings = (raw.settings ?? {}) as Record<string, Record<string, unknown>>;
    for (const [key, spec] of Object.entries(rawSettings)) {
      const type = typeof spec?.type === 'string' ? spec.type : 'text';
      const options = Array.isArray(spec?.options) ? spec.options.map(String) : [];
      if (!PluginManifest.KEY.test(key)) problems.push(`설정 이름 "${key}"는 camelCase여야 해요`);
      if (typeof spec?.label !== 'string') problems.push(`설정 "${key}"에 label이 없어요`);
      if (!SETTING_TYPES.includes(type)) {
        problems.push(`설정 "${key}"의 type은 ${SETTING_TYPES.join(', ')} 중 하나예요`);
      }
      if (type === 'select' && options.length === 0) {
        problems.push(`설정 "${key}"(select)에 options가 없어요`);
      }
      if (type === 'secret' && spec?.public === true) {
        problems.push(`비밀 설정 "${key}"는 공개할 수 없어요`);
      }
      settings.push(
        new PluginSettingSpec(
          key,
          String(spec?.label ?? key),
          type,
          spec?.required === true,
          typeof spec?.help === 'string' ? spec.help : '',
          typeof spec?.default === 'string' ? spec.default : '',
          options,
          spec?.public === true && type !== 'secret',
        ),
      );
    }

    const webSlots = new Map<string, string>();
    for (const [slot, path] of Object.entries((raw.web ?? {}) as Record<string, unknown>)) {
      if (!WEB_SLOTS.includes(slot)) {
        problems.push(`모르는 화면 자리예요: ${slot} (가능: ${WEB_SLOTS.join(', ')})`);
      }
      if (typeof path !== 'string' || !path.startsWith('web/') || !existsSync(join(dir, path))) {
        problems.push(`화면 자리 ${slot}의 파일이 web/ 안에 없어요: ${String(path)}`);
      }
      webSlots.set(slot, String(path));
    }

    const server = str('server') || null;
    if (server && (!/^server\/[^/]+\.ts$/.test(server) || !existsSync(join(dir, server)))) {
      problems.push(`server 파일이 server/ 안에 없어요: ${server}`);
    }
    const uses = new Set<string>();
    for (const use of Array.isArray(raw.uses) ? raw.uses : []) {
      if (typeof use !== 'string' || !USES.some((u) => u.test(use))) {
        problems.push(`모르는 확장 지점이에요: ${String(use)}`);
      } else uses.add(use);
    }
    if (uses.size > 0 && !server) problems.push('uses를 쓰려면 server 파일이 있어야 해요');

    // 기능 패키지: 자기 스키마 · API · MCP 도구 · 메뉴. 쓰려면 uses에도 적어 주인이 켤 때 허락한다
    const schema = str('schema') || null;
    if (schema) {
      if (!/^[a-z][a-z0-9_]{1,39}$/.test(schema) || CORE_SCHEMAS.includes(schema))
        problems.push(`schema는 소문자·숫자·밑줄이고 코어 스키마가 아니어야 해요: ${schema}`);
      if (!existsSync(join(dir, 'migrations')))
        problems.push('schema를 쓰려면 migrations/가 있어야 해요');
      if (!uses.has('table')) problems.push('schema를 쓰려면 uses에 table이 있어야 해요');
    }
    const api = new Map<string, string>();
    for (const [route, operation] of Object.entries((raw.api ?? {}) as Record<string, unknown>)) {
      if (!/^(GET|POST|PUT|PATCH|DELETE) \/[a-z0-9/:_-]*$/.test(route))
        problems.push(`api 경로는 "GET /이름/:id" 모양이에요: ${route}`);
      if (typeof operation !== 'string') problems.push(`api ${route}의 동작 이름이 없어요`);
      api.set(route, String(operation));
    }
    if (api.size > 0 && !uses.has('api')) problems.push('api를 쓰려면 uses에 api가 있어야 해요');
    const tools = new Map<string, PackageToolSpec>();
    for (const [tool, spec] of Object.entries(
      (raw.tools ?? {}) as Record<string, Record<string, unknown>>,
    )) {
      if (!uses.has(`tool:${tool}`))
        problems.push(`도구 ${tool}을 쓰려면 uses에 tool:${tool}이 있어야 해요`);
      if (typeof spec?.operation !== 'string' || typeof spec?.description !== 'string')
        problems.push(`도구 ${tool}에 operation · description이 없어요`);
      tools.set(tool, {
        operation: String(spec?.operation),
        description: String(spec?.description ?? ''),
        input: (spec?.input ?? { properties: {} }) as Record<string, unknown>,
      });
    }
    let menu: PackageMenu | null = null;
    if (raw.menu) {
      const m = raw.menu as Record<string, unknown>;
      const page = String(m.page ?? '');
      if (!page.startsWith('web/') || !existsSync(join(dir, page)))
        problems.push(`메뉴 화면 파일이 web/ 안에 없어요: ${page}`);
      if (!uses.has('menu')) problems.push('menu를 쓰려면 uses에 menu가 있어야 해요');
      menu = {
        group: String(m.group ?? ''),
        name: String(m.name ?? name),
        icon: String(m.icon ?? 'plug'),
        page,
      };
    }

    if (problems.length > 0) {
      throw new Error(`플러그인 ${name || dir} 목록 파일 문제:\n- ${problems.join('\n- ')}`);
    }
    return new PluginManifest(
      dir,
      name,
      str('version'),
      str('description'),
      settings,
      webSlots,
      server,
      uses,
      schema,
      api,
      tools,
      menu,
    );
  }

  /** 지금은 ">=0.1" 형태만 받는다 */
  private static supports(range: string): boolean {
    const m = /^>=(\d+)\.(\d+)$/.exec(range);
    if (!m) return false;
    const [major, minor] = CAIRN_PLUGIN_API.split('.').map(Number);
    return Number(m[1]) === major && Number(m[2]) <= (minor ?? 0);
  }
}
