import { seatOf } from './cairn-feed';
import type { LoadedAssetData } from './pixel/layout/furnitureCatalog';
import type { ColorValue, OfficeLayout, PlacedFurniture, SpriteData } from './pixel/types';
import { TileType } from './pixel/types';

// 사무실 그림과 배치. 가구·바닥·벽은 upstream 그림을 쓰지 않고 여기서 직접 그린다 (pixel/SOURCE.md).
// 색은 흑백 한 벌씩이고, 캐릭터까지 캔버스 전체를 CSS grayscale로 단색에 맞춘다.

const TILE = 16;
export const ROOM_COLS = 20;
export const ROOM_ROWS = 13;
export const ROOM_WIDTH = ROOM_COLS * TILE;
export const ROOM_HEIGHT = ROOM_ROWS * TILE;
const WALL_ROWS = 2;

const LIGHT = {
  floorA: '#f4f4f4',
  floorB: '#eeeeee',
  wall: 100,
  base: '#cfcfcf',
  glass: '#e4e4e4',
  pane: '#f7f7f7',
  board: '#fafafa',
  ink: '#8c8c8c',
  shelf: '#bdbdbd',
  shelfIn: '#d6d6d6',
  books: ['#6e6e6e', '#9a9a9a', '#4a4a4a', '#b5b5b5'],
  rug: '#e6e6e6',
  rugIn: '#ececec',
  sofa: '#a8a8a8',
  sofaTop: '#c2c2c2',
  sofaLow: '#8c8c8c',
  pot: '#6e6e6e',
  leaf: '#9a9a9a',
  leafTop: '#b5b5b5',
  machine: '#9a9a9a',
  machineIn: '#5e5e5e',
  desk: '#dcdcdc',
  deskFace: '#c2c2c2',
  leg: '#9a9a9a',
  bezel: '#2b2b2b',
  off: '#bdbdbd',
  on: '#0a0a0a',
  onAlt: '#3a3a3a',
  paper: '#ffffff',
};

const DARK: typeof LIGHT = {
  floorA: '#111111',
  floorB: '#161616',
  wall: -100,
  base: '#333333',
  glass: '#232323',
  pane: '#303030',
  board: '#d4d4d4',
  ink: '#6e6e6e',
  shelf: '#2e2e2e',
  shelfIn: '#1c1c1c',
  books: ['#8c8c8c', '#5e5e5e', '#b5b5b5', '#4a4a4a'],
  rug: '#1e1e1e',
  rugIn: '#242424',
  sofa: '#3d3d3d',
  sofaTop: '#4f4f4f',
  sofaLow: '#2b2b2b',
  pot: '#3d3d3d',
  leaf: '#6e6e6e',
  leafTop: '#8c8c8c',
  machine: '#3d3d3d',
  machineIn: '#1a1a1a',
  desk: '#303030',
  deskFace: '#242424',
  leg: '#3d3d3d',
  bezel: '#050505',
  off: '#2b2b2b',
  on: '#fafafa',
  onAlt: '#c8c8c8',
  paper: '#8c8c8c',
};

type Paint = (color: string, x: number, y: number, w: number, h: number) => void;

/** 빈 칸에 사각형을 칠해 그림 하나를 만든다 */
function draw(width: number, height: number, paint: (rect: Paint) => void): SpriteData {
  const pixels = Array.from({ length: height }, () => new Array<string>(width).fill(''));
  paint((color, x, y, w, h) => {
    for (let row = y; row < y + h; row++) pixels[row]?.fill(color, x, x + w);
  });
  return pixels;
}

const solid = (color: string) => draw(TILE, TILE, (rect) => rect(color, 0, 0, TILE, TILE));

type Asset = LoadedAssetData['catalog'][number];

function asset(
  id: string,
  footprintW: number,
  footprintH: number,
  sprite: SpriteData,
  more: Partial<Asset> = {},
): Asset {
  return {
    id,
    label: id,
    category: 'decor',
    width: sprite[0]?.length ?? 0,
    height: sprite.length,
    footprintW,
    footprintH,
    isDesk: false,
    ...more,
  };
}

/** 화면이 켜졌을 때 그림 순서. 그림 한 장이 0.2초라, 같은 그림을 세 번 두어 0.6초마다 바뀌게 한다 */
const SCREEN_FRAMES = ['on', 'on', 'on', 'onAlt', 'onAlt', 'onAlt'] as const;

/** 움직임을 줄이는 화면은 still: 켜진 화면이 깜빡이지 않는다 */
function furniture(p: typeof LIGHT, still: boolean): LoadedAssetData {
  const monitor = (screen: string) =>
    draw(TILE, TILE, (rect) => {
      rect(p.bezel, 1, 0, 14, 12);
      rect(screen, 2, 1, 12, 9);
      rect(p.bezel, 6, 12, 4, 3);
    });
  // 윗줄은 지나갈 수 있는 칸(backgroundTiles)이고, 의자에 앉으면 다리가 책상 뒤로 가려진다
  const desk = draw(48, 34, (rect) => {
    rect(p.desk, 0, 6, 48, 16);
    rect(p.deskFace, 0, 22, 48, 6);
    rect(p.leg, 2, 28, 4, 6);
    rect(p.leg, 42, 28, 4, 6);
    rect(p.paper, 34, 12, 10, 7);
  });
  const chair = draw(TILE, TILE, (rect) => {
    rect(p.sofa, 2, 0, 12, 9);
    rect(p.sofaTop, 3, 1, 10, 7);
    rect(p.leg, 7, 9, 2, 4);
    rect(p.leg, 4, 13, 8, 1);
  });
  const window = draw(48, 32, (rect) => {
    rect(p.glass, 6, 4, 36, 22);
    rect(p.pane, 8, 6, 15, 18);
    rect(p.pane, 25, 6, 15, 18);
  });
  const whiteboard = draw(64, 32, (rect) => {
    rect(p.board, 6, 2, 52, 24);
    rect(p.base, 6, 26, 52, 2);
    rect(p.ink, 12, 7, 18, 2);
    rect(p.ink, 12, 12, 30, 2);
    rect(p.ink, 12, 17, 22, 2);
  });
  const bookshelf = draw(48, 32, (rect) => {
    rect(p.shelf, 2, 0, 44, 30);
    for (let shelf = 0; shelf < 3; shelf++) {
      rect(p.shelfIn, 4, 2 + shelf * 9, 40, 8);
      for (let book = 0; book < 7; book++) {
        const color = p.books[(book + shelf * 2) % p.books.length] ?? p.ink;
        rect(color, 6 + book * 5, 3 + shelf * 9, 4, 7);
      }
    }
  });
  const sofa = draw(48, 28, (rect) => {
    rect(p.sofaTop, 2, 0, 44, 12);
    rect(p.sofa, 2, 10, 44, 14);
    rect(p.sofaLow, 2, 24, 44, 3);
  });
  const machine = draw(32, 32, (rect) => {
    rect(p.machine, 4, 2, 24, 28);
    rect(p.machineIn, 8, 6, 16, 10);
  });
  const plant = draw(TILE, 32, (rect) => {
    rect(p.pot, 3, 24, 10, 8);
    rect(p.leaf, 1, 14, 14, 11);
    rect(p.leafTop, 4, 10, 8, 7);
  });
  const baseboard = draw(ROOM_WIDTH, TILE, (rect) => rect(p.base, 0, 14, ROOM_WIDTH, 2));

  const onScreen = (frame: number) => (still ? p.on : p[SCREEN_FRAMES[frame] ?? 'on']);
  const screens = SCREEN_FRAMES.map((_, frame) => ({
    info: asset(`PC_ON_${frame}`, 1, 2, monitor(onScreen(frame)), {
      category: 'electronics',
      groupId: 'PC',
      state: 'on',
      animationGroup: 'PC_ON',
      frame,
      canPlaceOnSurfaces: true,
    }),
    sprite: monitor(onScreen(frame)),
  }));

  const catalog = [
    asset('DESK', 3, 2, desk, { category: 'desks', isDesk: true, backgroundTiles: 1 }),
    asset('CHAIR', 1, 1, chair, { category: 'chairs', orientation: 'front' }),
    asset('PC_OFF', 1, 2, monitor(p.off), {
      category: 'electronics',
      groupId: 'PC',
      state: 'off',
      canPlaceOnSurfaces: true,
    }),
    ...screens.map((s) => s.info),
    asset('BASEBOARD', ROOM_COLS, 1, baseboard, { category: 'wall' }),
    asset('WINDOW', 3, 2, window, { category: 'wall' }),
    asset('WHITEBOARD', 4, 2, whiteboard, { category: 'wall' }),
    asset('BOOKSHELF', 3, 2, bookshelf, { category: 'wall' }),
    asset('SOFA', 3, 2, sofa),
    asset('MACHINE', 2, 2, machine),
    asset('PLANT', 1, 2, plant, { backgroundTiles: 1 }),
  ];
  return {
    catalog,
    sprites: {
      DESK: desk,
      CHAIR: chair,
      PC_OFF: monitor(p.off),
      ...Object.fromEntries(screens.map((s) => [s.info.id, s.sprite])),
      BASEBOARD: baseboard,
      WINDOW: window,
      WHITEBOARD: whiteboard,
      BOOKSHELF: bookshelf,
      SOFA: sofa,
      MACHINE: machine,
      PLANT: plant,
    },
  };
}

const RUG = { left: 14, right: 18, top: 8, bottom: 11 };

function tileAt(col: number, row: number): TileType {
  if (row < WALL_ROWS) return TileType.WALL;
  const onRug = col >= RUG.left && col <= RUG.right && row >= RUG.top && row <= RUG.bottom;
  if (onRug) {
    const edge = col === RUG.left || col === RUG.right || row === RUG.top || row === RUG.bottom;
    return edge ? TileType.FLOOR_3 : TileType.FLOOR_4;
  }
  return (col + row) % 2 === 0 ? TileType.FLOOR_1 : TileType.FLOOR_2;
}

const DESK_COLS = [1, 5, 9];
const DESK_ROWS = [4, 9];

/** 책상 하나: 의자는 오른쪽에 앉아 모니터를 옆으로 본다 */
function workstation(seat: number, col: number, row: number): PlacedFurniture[] {
  return [
    { uid: `desk-${seat}`, type: 'DESK', col, row },
    { uid: seatOf(seat), type: 'CHAIR', col: col + 2, row },
    { uid: `pc-${seat}`, type: 'PC_OFF', col: col + 1, row },
  ];
}

/** 처음 그릴 배치. 자리가 모자라면 남는 에이전트는 서서 일한다 */
export function officeLayout(): OfficeLayout {
  const tiles: TileType[] = [];
  for (let row = 0; row < ROOM_ROWS; row++) {
    for (let col = 0; col < ROOM_COLS; col++) tiles.push(tileAt(col, row));
  }
  const desks = DESK_ROWS.flatMap((row, r) =>
    DESK_COLS.flatMap((col, c) => workstation(r * DESK_COLS.length + c, col, row)),
  );
  return {
    version: 1,
    cols: ROOM_COLS,
    rows: ROOM_ROWS,
    tiles,
    furniture: [
      { uid: 'baseboard', type: 'BASEBOARD', col: 0, row: 1 },
      { uid: 'window-1', type: 'WINDOW', col: 1, row: 0 },
      { uid: 'window-2', type: 'WINDOW', col: 4, row: 0 },
      { uid: 'whiteboard', type: 'WHITEBOARD', col: 8, row: 0 },
      { uid: 'bookshelf', type: 'BOOKSHELF', col: 13, row: 0 },
      ...desks,
      { uid: 'machine', type: 'MACHINE', col: 13, row: 2 },
      { uid: 'sofa', type: 'SOFA', col: 16, row: 2 },
      { uid: 'plant-1', type: 'PLANT', col: 0, row: 2 },
      { uid: 'plant-2', type: 'PLANT', col: 19, row: 5 },
      { uid: 'plant-3', type: 'PLANT', col: 13, row: 11 },
    ],
  };
}

/** 그림 한 벌: 바닥 무늬(FLOOR_1~4), 가구, 벽 색 */
export function roomArt(dark: boolean, still: boolean) {
  const p = dark ? DARK : LIGHT;
  const wall: ColorValue = { h: 0, s: 0, b: p.wall, c: 0 };
  const tiles = officeLayout().tiles;
  return {
    floors: [p.floorA, p.floorB, p.rug, p.rugIn].map(solid),
    assets: furniture(p, still),
    /** 벽 칸의 색. 바닥은 무늬가 이미 단색이라 null */
    tileColors: tiles.map((tile) => (tile === TileType.WALL ? wall : null)),
  };
}
