import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { InvalidRequest } from '../../../apps/server/src/plugin-api';
import { FakeCdp } from './fake-cdp';
import { ScreenControl } from './screen';
import { BrowserScreenGateway } from './screen.gateway';

// 콘솔에서 서버 브라우저를 보고 누르기 (2026-11-14): 가짜 CDP로 무엇을 보내는지 본다.
// 진짜 Chromium(화면 있는 모드)으로는 캡처 · 클릭 · 한글 입력 · Enter · 스크롤 · 이동 · 뒤로를 따로 확인했다.

let cdp: FakeCdp;
let screen: BrowserScreenGateway;
const A = 'A'.repeat(32);
const D = 'D'.repeat(32);

before(async () => {
  cdp = await FakeCdp.start();
  screen = new BrowserScreenGateway('127.0.0.1', cdp.port);
});
after(() => cdp.close());

const sent = (tab: string) => cdp.calls.filter((c) => c.tab === tab).map((c) => c.method);

describe('서버 브라우저 화면', () => {
  test('탭은 페이지만 (도구 · 일꾼은 빼고), 고르지 않으면 맨 앞 탭을 JPEG로 그린다', async () => {
    const shot = await screen.shot(null);
    assert.deepEqual(
      shot.tabs.map((t) => t.id),
      [A, D],
    );
    assert.equal(shot.tab, A);
    assert.equal(Buffer.from(shot.image, 'base64').toString(), 'jpeg');
    assert.deepEqual([shot.width, shot.height], [1280, 720], '클릭 좌표의 기준 (CSS 픽셀, 반올림)');
    const capture = cdp.calls.find((c) => c.method === 'Page.captureScreenshot');
    assert.equal(capture?.params.format, 'jpeg');
  });

  test('고른 탭을 그리고, 닫힌 탭을 고르면 맨 앞 탭으로', async () => {
    assert.equal((await screen.shot(D)).tab, D);
    assert.equal((await screen.shot('Z'.repeat(32))).tab, A);
  });

  test('클릭은 옮기고 · 누르고 · 떼고, 좌표를 그대로 보낸다', async () => {
    cdp.calls.length = 0;
    await screen.control(D, { type: 'click', x: 10, y: 20 });
    const mouse = cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
    assert.deepEqual(
      mouse.map((c) => [c.params.type, c.params.x, c.params.y]),
      [
        ['mouseMoved', 10, 20],
        ['mousePressed', 10, 20],
        ['mouseReleased', 10, 20],
      ],
    );
    assert.ok(mouse.every((c) => c.tab === D));
  });

  test('Enter는 글자(\\r)와 함께 눌러 폼을 보내고, 화살표는 글자 없이', async () => {
    cdp.calls.length = 0;
    await screen.control(A, { type: 'key', key: 'Enter' });
    await screen.control(A, { type: 'key', key: 'ArrowDown' });
    const keys = cdp.calls.map((c) => [c.params.type, c.params.key, c.params.text]);
    assert.deepEqual(keys, [
      ['keyDown', 'Enter', '\r'],
      ['keyUp', 'Enter', undefined],
      ['rawKeyDown', 'ArrowDown', undefined],
      ['keyUp', 'ArrowDown', undefined],
    ]);
  });

  test('글자 · 스크롤 · 뒤로 · 앞으로 가져오기', async () => {
    cdp.calls.length = 0;
    await screen.control(A, { type: 'text', text: '안녕' });
    await screen.control(A, { type: 'scroll', x: 5, y: 6, dy: -300 });
    await screen.control(A, { type: 'back' });
    await screen.control(A, { type: 'activate' });
    assert.deepEqual(sent(A), [
      'Input.insertText',
      'Input.dispatchMouseEvent',
      'Page.getNavigationHistory',
      'Page.navigateToHistoryEntry',
      'Page.bringToFront',
    ]);
    assert.equal(cdp.calls[0]?.params.text, '안녕');
    assert.equal(cdp.calls[3]?.params.entryId, 11, '지금(1)의 앞 항목');
  });

  test('닫힌 탭 · 브라우저가 거절한 명령 · 브라우저가 없음은 오류로', async () => {
    await assert.rejects(screen.control('Z'.repeat(32), { type: 'activate' }), /닫힌 탭이에요/);
    await assert.rejects(screen.control(A, { type: 'navigate', url: 'https://x' }), /invalid URL/);
    const none = new BrowserScreenGateway('no-such-host.invalid', cdp.port);
    await assert.rejects(none.shot(null), /서버 브라우저가 꺼져 있거나/);
  });
});

describe('화면 동작의 입력', () => {
  const control = new ScreenControl(new BrowserScreenGateway('127.0.0.1', 1));
  const bad = (raw: object, field: string) =>
    assert.throws(
      () => control.input(raw),
      (e: unknown) => e instanceof InvalidRequest && JSON.stringify(e).includes(field),
    );

  test('종류마다 칸을 읽는다', () => {
    assert.deepEqual(control.input({ tab: A, type: 'click', x: 1, y: 2 }).action, {
      type: 'click',
      x: 1,
      y: 2,
    });
    assert.deepEqual(control.input({ tab: A, type: 'back' }).action, { type: 'back' });
  });

  test('모르는 종류 · 키, http(s)가 아닌 주소, 이상한 탭 id, 범위 밖 좌표는 400', () => {
    bad({ tab: A, type: 'drag' }, 'type');
    bad({ tab: A, type: 'key', key: 'F12' }, 'key');
    bad({ tab: A, type: 'navigate', url: 'javascript:alert(1)' }, 'url');
    bad({ tab: '../json', type: 'back' }, 'tab');
    bad({ tab: A, type: 'click', x: -1, y: 0 }, 'x');
  });
});
