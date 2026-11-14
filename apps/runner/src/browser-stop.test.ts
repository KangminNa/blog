import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { BrowserSlot } from './browser-slot';
import { BrowserStop, BrowserStopProblem } from './browser-stop';

// AI가 멈춘 자리(browser-stop.json)는 믿지 않는 입력이다: 모양 · 링크 · 크기를 본다.
// 브라우저 자리(BrowserSlot): 사이트 일과 결재된 클릭이 차례대로 하나씩.

describe('멈춘 자리 (browser-stop.json)', () => {
  test('final_click은 역할 · 이름 · 순번, login은 주소만', () => {
    const click = BrowserStop.of({
      stop: 'final_click',
      page_url: 'https://blog.example/write',
      button: { role: 'Button', name: ' 게시 ' },
      note: '제목과 본문을 채웠어요',
    });
    assert.deepEqual(
      [
        click.kind,
        click.pageUrl,
        click.button?.role,
        click.button?.name,
        click.button?.nth,
        click.note,
      ],
      ['final_click', 'https://blog.example/write', 'button', '게시', 0, '제목과 본문을 채웠어요'],
    );
    const login = BrowserStop.of({ stop: 'login', page_url: 'https://accounts.example/login' });
    assert.deepEqual([login.kind, login.button], ['login', null]);
  });

  test('틀린 모양은 붙잡지 않는다', () => {
    for (const raw of [
      { stop: 'publish', page_url: 'https://a.example' },
      {
        stop: 'final_click',
        page_url: 'javascript:alert(1)',
        button: { role: 'button', name: 'x' },
      },
      { stop: 'final_click', page_url: 'https://a.example', button: { role: 'button' } },
      { stop: 'final_click', page_url: 'https://a.example', button: { role: 'a b', name: 'x' } },
      {
        stop: 'final_click',
        page_url: 'https://a.example',
        button: { role: 'button', name: 'x', nth: -1 },
      },
      null,
    ])
      assert.throws(() => BrowserStop.of(raw), BrowserStopProblem, JSON.stringify(raw));
  });

  test('없으면 null, JSON이 아니거나 링크면 문제', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-stop-'));
    try {
      assert.equal(await BrowserStop.read(join(dir, BrowserStop.FILE)), null);
      writeFileSync(join(dir, 'bad.json'), '{');
      await assert.rejects(BrowserStop.read(join(dir, 'bad.json')), BrowserStopProblem);
      writeFileSync(
        join(dir, 'real.json'),
        JSON.stringify({ stop: 'login', page_url: 'https://a.example' }),
      );
      symlinkSync(join(dir, 'real.json'), join(dir, BrowserStop.FILE));
      await assert.rejects(BrowserStop.read(join(dir, BrowserStop.FILE)), BrowserStopProblem);
      assert.equal((await BrowserStop.read(join(dir, 'real.json')))?.kind, 'login');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('브라우저 자리', () => {
  test('하나씩 차례대로: 앞이 놓아야 뒤가 잡는다', async () => {
    const slot = new BrowserSlot();
    const stop = new AbortController().signal;
    const order: string[] = [];
    const first = await slot.take(stop);
    const second = slot.take(stop).then((free) => {
      order.push('둘째');
      return free;
    });
    await new Promise((done) => setTimeout(done, 20));
    assert.deepEqual(order, [], '앞이 쥔 동안은 기다린다');
    first?.();
    first?.();
    (await second)?.();
    assert.deepEqual(order, ['둘째']);
    assert.ok(await slot.take(stop), '다 놓으면 바로 잡는다');
  });

  test('기다리다 멈추면 null이고, 줄은 이어진다', async () => {
    const slot = new BrowserSlot();
    const held = await slot.take(new AbortController().signal);
    const cut = new AbortController();
    const waiting = slot.take(cut.signal);
    cut.abort();
    assert.equal(await waiting, null);
    const third = slot.take(new AbortController().signal);
    held?.();
    assert.ok(await third, '멈춘 쪽을 건너 다음이 잡는다');
  });
});
