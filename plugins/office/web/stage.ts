import char0 from './pixel/characters/char_0.png';
import char1 from './pixel/characters/char_1.png';
import char2 from './pixel/characters/char_2.png';
import char3 from './pixel/characters/char_3.png';
import char4 from './pixel/characters/char_4.png';
import char5 from './pixel/characters/char_5.png';
import { BUBBLE_SITTING_OFFSET_PX, BUBBLE_VERTICAL_OFFSET_PX } from './pixel/constants';
import { reconcileExistingAgents } from './pixel/engine/existingAgents';
import { startGameLoop } from './pixel/engine/gameLoop';
import { OfficeState } from './pixel/engine/officeState';
import { renderFrame } from './pixel/engine/renderer';
import { setFloorSprites } from './pixel/floorTiles';
import { buildDynamicCatalog } from './pixel/layout/furnitureCatalog';
import type { ServerMessage } from './pixel/messages';
import { getCachedSprite } from './pixel/sprites/spriteCache';
import { BUBBLE_PERMISSION_SPRITE, setCharacterTemplates } from './pixel/sprites/spriteData';
import { setProviderCapabilities } from './pixel/toolUtils';
import type { MessageTransport } from './pixel/transport';
import type { ColorValue, SpriteData } from './pixel/types';
import { CharacterState, TILE_SIZE } from './pixel/types';
import { officeLayout, ROOM_HEIGHT, ROOM_WIDTH, roomArt } from './room';

// 캔버스 쪽. Pixel Agents의 OfficeState를 돌리고 그린다. 무거워서 Office.tsx가 필요할 때만 불러온다.
// upstream의 useExtensionMessages·OfficeCanvas·ToolOverlay가 하던 일 중 오피스에 필요한 것만 여기서 한다.

const SHEETS = [char0, char1, char2, char3, char4, char5];
/** 캐릭터 그림 한 장: 16×32, 7프레임, 줄은 아래·위·오른쪽 (upstream core/src/assets/constants.ts) */
const FRAME_W = 16;
const FRAME_H = 32;
const FRAMES = 7;
const ALPHA_MIN = 128;
/** 움직임을 줄이는 화면의 다시 그리는 간격과, 그때마다 흐른 것으로 치는 시간 */
const STILL_MS = 500;
const STILL_STEP_SEC = 0.2;
/** 이름표: 머리 위 (말풍선과 겹치지 않는 높이) */
const TAG_ABOVE_PX = 34;
const SITTING_PX = 6;

type Sheet = { down: SpriteData[]; up: SpriteData[]; right: SpriteData[] };

/** 그림 파일을 픽셀 표로. upstream은 서버가 하는 일이라 브라우저 캔버스로 대신한다 */
async function readSheet(url: string): Promise<Sheet> {
  const image = new Image();
  // decode()는 숨은 탭에서 끝나지 않을 수 있어 load를 기다린다
  await new Promise((done, fail) => {
    image.onload = done;
    image.onerror = fail;
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('캔버스를 쓸 수 없는 브라우저예요');
  ctx.drawImage(image, 0, 0);
  const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const hex = (at: number) =>
    (data[at + 3] ?? 0) < ALPHA_MIN
      ? ''
      : `#${[data[at], data[at + 1], data[at + 2]]
          .map((v) => (v ?? 0).toString(16).padStart(2, '0'))
          .join('')}`;
  const frame = (row: number, index: number): SpriteData =>
    Array.from({ length: FRAME_H }, (_, y) =>
      Array.from({ length: FRAME_W }, (_, x) =>
        hex(((row * FRAME_H + y) * width + index * FRAME_W + x) * 4),
      ),
    );
  const row = (index: number) => Array.from({ length: FRAMES }, (_, f) => frame(index, f));
  return { down: row(0), up: row(1), right: row(2) };
}

/** 화면에 있는 요소들. React가 만들고 여기서 위치와 크기만 바꾼다 */
export type StageView = {
  /** 너비를 재는 바깥 칸 */
  box: HTMLElement;
  /** 캔버스 크기에 맞춰 줄어드는 안쪽 칸 (이름표의 기준) */
  frame: HTMLElement;
  canvas: HTMLCanvasElement;
  /** data-pixel에 캐릭터 번호가 적힌 이름표들의 부모 */
  tags: HTMLElement;
};

export class OfficeStage {
  private readonly office: OfficeState;
  private readonly layout = officeLayout();
  private readonly stillQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly undo: (() => void)[] = [];
  private tileColors: (ColorValue | null)[] = [];
  private zoom = 1;
  private stopDrawing: (() => void) | null = null;

  private constructor(
    private readonly view: StageView,
    private readonly canOpen: (pixelId: number) => boolean,
    private readonly onOpen: (pixelId: number) => void,
  ) {
    this.applyArt();
    this.office = new OfficeState(this.layout);
  }

  static async open(
    view: StageView,
    feed: MessageTransport,
    canOpen: (pixelId: number) => boolean,
    onOpen: (pixelId: number) => void,
  ): Promise<OfficeStage> {
    setCharacterTemplates(await Promise.all(SHEETS.map((sheet) => readSheet(sheet.src))));
    const stage = new OfficeStage(view, canOpen, onOpen);
    stage.undo.push(feed.onMessage((message) => stage.apply(message)));
    stage.mount();
    return stage;
  }

  /** 그리기를 멈추고 건 것을 모두 푼다 */
  stop(): void {
    this.pause();
    for (const undo of this.undo) undo();
  }

  private get still(): boolean {
    return this.stillQuery.matches;
  }

  private applyArt(): void {
    const mode = getComputedStyle(document.documentElement).getPropertyValue('--mode');
    const art = roomArt(mode.trim() === 'dark', this.still);
    setFloorSprites(art.floors);
    buildDynamicCatalog(art.assets);
    this.tileColors = art.tileColors;
  }

  private mount(): void {
    const { box, canvas } = this.view;
    const fit = new ResizeObserver(() => this.fit());
    fit.observe(box);
    this.fit();

    const repaint = () => this.applyArt();
    const theme = new MutationObserver(repaint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.darkQuery.addEventListener('change', repaint);

    const restart = () => {
      this.pause();
      this.applyArt();
      this.play();
    };
    this.stillQuery.addEventListener('change', restart);

    const visibility = () => (document.hidden ? this.pause() : this.play());
    document.addEventListener('visibilitychange', visibility);

    const hover = (event: PointerEvent) => {
      const id = this.characterAt(event);
      this.office.hoveredAgentId = id;
      canvas.style.cursor = id !== null && this.canOpen(id) ? 'pointer' : '';
    };
    const leave = () => {
      this.office.hoveredAgentId = null;
    };
    const click = (event: MouseEvent) => {
      const id = this.characterAt(event);
      if (id !== null) this.onOpen(id);
    };
    canvas.addEventListener('pointermove', hover);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('click', click);

    this.undo.push(() => {
      fit.disconnect();
      theme.disconnect();
      this.darkQuery.removeEventListener('change', repaint);
      this.stillQuery.removeEventListener('change', restart);
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointermove', hover);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('click', click);
    });
    this.play();
  }

  /** 정수 배로 키워야 픽셀이 고르다: 기기 픽셀 기준으로 칸에 들어가는 가장 큰 배율을 쓴다 */
  private fit(): void {
    const { box, frame, canvas } = this.view;
    const dpr = window.devicePixelRatio || 1;
    const zoom = Math.max(1, Math.floor((box.clientWidth * dpr) / ROOM_WIDTH));
    this.zoom = zoom;
    canvas.width = ROOM_WIDTH * zoom;
    canvas.height = ROOM_HEIGHT * zoom;
    frame.style.width = `${(ROOM_WIDTH * zoom) / dpr}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) this.draw(ctx);
  }

  private play(): void {
    if (this.stopDrawing || document.hidden) return;
    const { canvas } = this.view;
    if (!this.still) {
      this.stopDrawing = startGameLoop(canvas, {
        update: (dt) => this.office.update(dt),
        render: (ctx) => this.draw(ctx),
      });
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const tick = () => {
      this.office.update(STILL_STEP_SEC);
      this.settle();
      ctx.imageSmoothingEnabled = false;
      this.draw(ctx);
    };
    tick();
    const timer = setInterval(tick, STILL_MS);
    this.stopDrawing = () => clearInterval(timer);
  }

  private pause(): void {
    this.stopDrawing?.();
    this.stopDrawing = null;
  }

  /** 움직임을 줄이는 화면: 걷지 않고, 일하면 앉아 있고 쉬면 자리 옆에 서 있다 */
  private settle(): void {
    for (const ch of this.office.characters.values()) {
      const seat = ch.seatId ? this.office.seats.get(ch.seatId) : undefined;
      ch.path = [];
      ch.moveProgress = 0;
      if (seat) {
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        ch.dir = seat.facingDir;
      }
      ch.state = ch.isActive ? CharacterState.TYPE : CharacterState.IDLE;
      ch.frame = 0;
    }
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    const { office, layout, zoom } = this;
    const { canvas } = this.view;
    renderFrame(
      ctx,
      canvas.width,
      canvas.height,
      office.tileMap,
      office.furniture,
      office.getCharacters(),
      zoom,
      0,
      0,
      {
        selectedAgentId: null,
        hoveredAgentId: office.hoveredAgentId,
        hoveredTile: null,
        seats: office.seats,
        characters: office.characters,
      },
      undefined,
      this.tileColors,
      layout.cols,
      layout.rows,
    );
    this.drawBubbles(ctx);
    this.moveTags();
  }

  /** 결재 대기 말풍선. upstream은 DOM(ToolOverlay)으로 그리지만 여기서는 캔버스 하나로 끝낸다 */
  private drawBubbles(ctx: CanvasRenderingContext2D): void {
    const { office, zoom } = this;
    const bubble = getCachedSprite(BUBBLE_PERMISSION_SPRITE, zoom);
    for (const ch of office.characters.values()) {
      if (ch.bubbleType !== 'permission') continue;
      const sitting = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
      const x = Math.round(ch.x * zoom - bubble.width / 2);
      const y = (ch.y + sitting - BUBBLE_VERTICAL_OFFSET_PX) * zoom - bubble.height - zoom;
      ctx.drawImage(bubble, x, Math.round(y));
    }
  }

  private moveTags(): void {
    for (const tag of Array.from(this.view.tags.children) as HTMLElement[]) {
      const ch = this.office.characters.get(Number(tag.dataset.pixel));
      tag.hidden = !ch;
      if (!ch) continue;
      const sitting = ch.state === CharacterState.TYPE ? SITTING_PX : 0;
      tag.style.left = `${(ch.x / ROOM_WIDTH) * 100}%`;
      tag.style.top = `${((ch.y + sitting - TAG_ABOVE_PX) / ROOM_HEIGHT) * 100}%`;
    }
  }

  private characterAt(event: MouseEvent): number | null {
    const { canvas } = this.view;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * ROOM_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * ROOM_HEIGHT;
    return this.office.getCharacterAt(x, y);
  }

  /** 메시지 → 캐릭터 동작. upstream useExtensionMessages의 같은 메시지 처리에서 사무실에 닿는 부분만 */
  private apply(message: ServerMessage): void {
    const { office } = this;
    switch (message.type) {
      case 'providerCapabilities':
        setProviderCapabilities(message);
        break;
      case 'existingAgents':
        reconcileExistingAgents(office, message.agents, message.agentMeta, {}, true, []);
        break;
      case 'agentCreated':
        office.addAgent(message.id, message.palette, message.hueShift, message.seatId, this.still);
        break;
      case 'agentClosed':
        office.removeAgent(message.id);
        break;
      case 'agentStatus':
        // waiting의 완료 말풍선은 띄우지 않는다: 작업이 끝났는지 실패했는지 여기서는 모른다
        office.setAgentActive(message.id, message.status === 'active');
        break;
      case 'agentToolStart':
        office.setAgentTool(message.id, message.toolName ?? null);
        office.setAgentActive(message.id, true);
        office.clearPermissionBubble(message.id);
        break;
      case 'agentToolDone':
        break;
      case 'agentToolsClear':
        office.setAgentTool(message.id, null);
        office.clearPermissionBubble(message.id);
        break;
      case 'agentToolPermission':
        office.showPermissionBubble(message.id);
        break;
      case 'agentToolPermissionClear':
        office.clearPermissionBubble(message.id);
        break;
    }
  }
}
