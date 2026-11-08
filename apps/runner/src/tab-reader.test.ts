import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type BrowserTabs, BrowserUnavailable, TabText, TabUnreadable } from './browser-tabs';
import type { CairnServer } from './cairn-server';
import { ToolRefused } from './mcp-client';
import { Redactor, RunLog } from './redactor';
import { TabReader } from './tab-reader';

// 탭 읽기 루프: 받은 주소를 읽어 남기고, 못 읽으면 이유를 남기고, 패키지가 꺼져 있으면 조용히 기다린다.

type Saved = { id: string; read: object };

function fakes(
  answers: (() => readonly { id: string; url: string }[])[],
  read: (url: string) => TabText,
) {
  const saved: Saved[] = [];
  const stopper = new AbortController();
  const server = {
    async pendingTabs() {
      const next = answers.shift();
      if (!next) {
        stopper.abort();
        return [];
      }
      return next();
    },
    async saveTab(id: string, r: object) {
      saved.push({ id, read: r });
    },
  } as unknown as CairnServer;
  const browser = {
    async read(url: string) {
      return read(url);
    },
  } as unknown as BrowserTabs;
  return { saved, stopper, reader: new TabReader(server, browser, new RunLog(new Redactor([]))) };
}

describe('TabReader', () => {
  test('읽은 탭은 제목과 글자를, 못 읽은 탭은 이유를 남긴다', async () => {
    const { saved, stopper, reader } = fakes(
      [
        () => [
          { id: 'a', url: 'https://ok.example/x' },
          { id: 'b', url: 'https://bad.example/' },
        ],
      ],
      (url) => {
        if (url.includes('bad')) throw new TabUnreadable('30초 안에 다 뜨지 않았어요');
        return TabText.of('제목', '본문');
      },
    );
    await reader.run(stopper.signal);
    assert.deepEqual(saved, [
      { id: 'a', read: { title: '제목', body: '본문' } },
      { id: 'b', read: { error: '30초 안에 다 뜨지 않았어요' } },
    ]);
  });

  test('브라우저에 닿지 못하면 실패로 남기지 않는다 (요청은 그대로, 나중에 다시)', async () => {
    const { saved, stopper, reader } = fakes(
      [() => [{ id: 'a', url: 'https://ok.example/x' }]],
      () => {
        throw new BrowserUnavailable('브라우저(http://127.0.0.1:9222)에 닿지 못했어요');
      },
    );
    setTimeout(() => stopper.abort(), 50);
    await reader.run(stopper.signal);
    assert.deepEqual(saved, []);
  });

  test('패키지가 꺼져 있으면(도구 없음) 아무것도 남기지 않고 멈출 때까지 기다린다', async () => {
    const { saved, stopper, reader } = fakes(
      [
        () => {
          throw new ToolRefused('tool', 'browser_tab_pending 도구가 없어요');
        },
      ],
      () => TabText.of('', ''),
    );
    setTimeout(() => stopper.abort(), 50);
    await reader.run(stopper.signal);
    assert.deepEqual(saved, []);
  });

  test('제목과 글자는 서버 도구의 한도에 맞춰 자른다', () => {
    const text = TabText.of('가'.repeat(400), '나'.repeat(TabText.BODY_MAX + 10));
    assert.equal(text.title.length, TabText.TITLE_MAX);
    assert.equal(text.body.length, TabText.BODY_MAX);
  });
});
