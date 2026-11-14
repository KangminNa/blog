import { Forbidden } from './errors';
import type { SecretBox } from './secret-box';

// 요청한 주체. Guard가 만들고, Service는 첫 줄에서 권한을 묻고, Query는 공개 범위를 거를 때 쓴다.
// 모듈 경계를 넘을 수 있도록 값으로만 이루어진다 (서버를 나누면 그대로 토큰 내용이 된다).
export abstract class Actor {
  static readonly UPLOAD = 'upload';
  static readonly READ_PUBLIC = 'read_public';
  static readonly READ_ALL = 'read_all';
  static readonly TIDY = 'tidy';
  static readonly WRITE = 'write';
  /** 러너: 일을 빌리고, 진행을 알리고, 끝낸다 */
  static readonly RUN = 'run';
  /** 에이전트: 서버 브라우저로 하는 작업(browse)을 맡는다. read_all과 함께 줄 수 없다 */
  static readonly BROWSE = 'browse';
  /** 에이전트: 코드 작업(code)을 맡는다. read_all · write와 함께 줄 수 없다 (docs/코드작업.md) */
  static readonly CODE = 'code';
  /** 에이전트: 만들기 작업(make)을 맡는다. 칸 안에서 셸로 파일을 만든다. read_all · write와 함께 줄 수 없다 */
  static readonly MAKE = 'make';
  /**
   * 기기: 코드 러너 칸. 셸이 있는 일(Task.SANDBOXED)을 빌린다. 칸으로 연결할 때만 생기고 주인이 줄 수 없다.
   * 러너가 알리는 값이 아니라 이 권한으로 판단한다: 내 컴퓨터 러너가 칸이라고 말해도 셸 있는 일을 받지 못하게
   */
  static readonly SANDBOX = 'sandbox';
  /**
   * 기기: 서버 팀(관리자 바로 아래 에이전트, 비우면 기본 대표)에게 일을 맡기고 소식을 받는다 (MCP ask_agent · agent_updates).
   * 관리자가 기기 메뉴에서 켠다. 그 기기가 연 대화만 이어 쓰고 읽는다. 결재는 하지 못한다
   */
  static readonly DELEGATE = 'delegate';
  /**
   * 기기: 대화의 소식만 읽는다 (MCP agent_updates, 2차 1-3). 내 컴퓨터의 훅 · 상태 줄이 쓰는 소식 기기의 권한이고
   * 다른 권한과 함께 두지 않는다 (보내기 · 결재 · 읽기 넓히기 없음)
   */
  static readonly NEWS = 'news';
  /**
   * 기기: 기다리는 결재 · 질문만 읽는다 (MCP inbox, 2차 4단계). 브라우저 확장이 아이콘의 숫자로 보인다.
   * 확장 기기(OAuth scope=extension)가 갖고, 관리자도 기기 메뉴에서 줄 수 있다
   */
  static readonly INBOX = 'inbox';
  /** 작업 토큰을 가진 에이전트만의 자격 (request_approval). 기기에 줄 수 있는 권한이 아니다 */
  static readonly AGENT = 'agent';

  abstract readonly kind: string;

  constructor(
    readonly spaceId: string | null,
    readonly id: string | null,
  ) {}

  abstract can(scope: string): boolean;

  assertCan(scope: string): void {
    if (!this.can(scope)) throw new Forbidden(scope);
  }

  /**
   * 주인만 할 수 있는 일 (결재, 에이전트·작업 관리). 권한 이름이 아니라 종류로 묻는다:
   * write 권한을 가진 기기나 에이전트가 스스로 결재하지 못하게.
   */
  assertOwner(): void {
    if (this.kind !== 'owner') throw new Forbidden('owner', '관리자만 할 수 있어요');
  }

  /**
   * 주인이나 서버 자신(명령줄·일꾼)만 하는 관리 일 (플러그인 켜기·설정·동작, 서버 키 교체, 복원).
   * assertOwner처럼 종류로 묻는다: write 권한을 가진 기기가 관리 일에 닿지 못하게.
   */
  assertOwnerOrSystem(): void {
    if (this.kind !== 'system') this.assertOwner();
  }

  /** 관리 화면의 정보(설정 칸, 필요한 권한 등)를 볼 수 있는가: 주인이나 서버 자신. 권한 이름이 아니라 종류로 */
  canManage(): boolean {
    return this.kind === 'owner' || this.kind === 'system';
  }

  /** 요청자의 공간. 공간이 없는 요청자(방문자)는 Forbidden */
  requireSpace(): string {
    if (!this.spaceId) throw new Forbidden('owner');
    return this.spaceId;
  }

  /**
   * 코드 러너 칸의 기기인가 (셸이 있는 일을 빌린다). 권한 이름만으로 묻지 않는다: 주인은 모든 권한을 가진다.
   * 러너가 알리는 값이 아니라 기기의 권한으로 정한다
   */
  inSandbox(): boolean {
    return this.kind === 'device' && this.can(Actor.SANDBOX);
  }

  /** 비공개 데이터까지 볼 수 있는가 */
  canSeePrivate(): boolean {
    return this.can(Actor.READ_ALL);
  }

  /**
   * 이 요청자에게만 따로 읽기를 허락한 id인가 (작업 토큰에 봉인한 허락). 권한(read_all)과 다르다:
   * 찾기 · 목록 · 그래프에는 나오지 않고, id로 하나를 읽을 때만 본다
   */
  mayRead(_id: string): boolean {
    return false;
  }

  /** 따로 읽기를 허락받은 것이 하나라도 있는가 (id로 읽는 도구를 열지 정할 때) */
  hasReadGrants(): boolean {
    return false;
  }

  toJSON(): object {
    return { kind: this.kind, spaceId: this.spaceId, id: this.id };
  }
}

/** 블로그 주인 (관리 모드) */
export class OwnerActor extends Actor {
  readonly kind = 'owner';

  constructor(spaceId: string, userId: string) {
    super(spaceId, userId);
  }

  can(): boolean {
    return true;
  }
}

/** 연결된 기기의 AI 도구 (MCP). 기기에 준 권한만 */
export class DeviceActor extends Actor {
  readonly kind = 'device';

  constructor(
    spaceId: string,
    deviceId: string,
    private readonly scopes: ReadonlySet<string>,
  ) {
    super(spaceId, deviceId);
  }

  can(scope: string): boolean {
    return this.scopes.has(scope);
  }

  override toJSON(): object {
    return { ...super.toJSON(), scopes: [...this.scopes] };
  }
}

/**
 * 작업 하나를 하는 에이전트 (MCP). 그 에이전트에 정해 둔 권한만 담은 작업 토큰으로 들어온다.
 * 토큰은 서버 키로 싸서 저장하지 않는다. 작업이 살아 있는지는 호출마다 mcp 모듈이 task에 묻는다.
 */
export class AgentActor extends Actor {
  private static readonly PREFIX = 'cairn_run_';
  /** 다른 용도로 싼 값이 작업 토큰으로 풀리지 않게 안쪽에 붙이는 표시 */
  private static readonly PURPOSE = 'agent-run';
  readonly kind = 'agent';

  constructor(
    spaceId: string,
    agentId: string,
    readonly taskId: string,
    private readonly scopes: ReadonlySet<string>,
    /** 이 작업에만 따로 읽기를 허락한 id (주인이 고른 재료). 권한과 함께 토큰에 봉인한다 */
    private readonly reads: ReadonlySet<string> = new Set(),
  ) {
    super(spaceId, agentId);
  }

  static isToken(bearer: string): boolean {
    return bearer.startsWith(AgentActor.PREFIX);
  }

  /** 작업 토큰을 푼다. 이 서버 키로 싼 작업 토큰이고 만료 전일 때만 */
  static open(box: SecretBox, token: string): AgentActor | null {
    if (!box.ready || !AgentActor.isToken(token)) return null;
    const opened = box.unpack(AgentActor.PURPOSE, token.slice(AgentActor.PREFIX.length));
    if (opened === null) return null;
    const v = JSON.parse(opened) as {
      spaceId: string;
      agentId: string;
      taskId: string;
      scopes: string[];
      reads?: string[];
    };
    return new AgentActor(v.spaceId, v.agentId, v.taskId, new Set(v.scopes), new Set(v.reads));
  }

  get agentId(): string {
    return this.id ?? '';
  }

  /** 작업 토큰을 만든다 */
  seal(box: SecretBox, seconds: number): string {
    const value = JSON.stringify({
      spaceId: this.spaceId,
      agentId: this.id,
      taskId: this.taskId,
      scopes: [...this.scopes],
      reads: [...this.reads],
    });
    return `${AgentActor.PREFIX}${box.pack(AgentActor.PURPOSE, value, seconds)}`;
  }

  can(scope: string): boolean {
    return scope === Actor.AGENT || this.scopes.has(scope);
  }

  override mayRead(id: string): boolean {
    return this.reads.has(id);
  }

  override hasReadGrants(): boolean {
    return this.reads.size > 0;
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      taskId: this.taskId,
      scopes: [...this.scopes],
      reads: [...this.reads],
    };
  }
}

/**
 * 주인이 결재로 허락한 동작 하나를 일꾼이 대신 실행할 때의 요청자. id는 승인한 주인이다.
 * 사람이 없는 자리(Handler)에서 주인의 규칙을 통과시키되, 어느 결재 덕분인지 값으로 남긴다.
 */
export class ApprovedActor extends Actor {
  readonly kind = 'approved';

  constructor(
    spaceId: string,
    deciderId: string,
    readonly approvalId: string,
    readonly action: string,
  ) {
    super(spaceId, deciderId);
  }

  can(scope: string): boolean {
    return scope === Actor.WRITE;
  }

  override toJSON(): object {
    return { ...super.toJSON(), approvalId: this.approvalId, action: this.action };
  }
}

/** 로그인하지 않은 방문자. 공개된 것만 */
export class VisitorActor extends Actor {
  readonly kind = 'visitor';

  constructor() {
    super(null, null);
  }

  can(): boolean {
    return false;
  }
}

/** 일꾼·예약 작업처럼 사람이 아닌 서버 자신. 목록 파일에서 허락받은 일만 이 자격으로 한다 */
export class SystemActor extends Actor {
  readonly kind = 'system';

  constructor() {
    super(null, null);
  }

  can(): boolean {
    return true;
  }
}
