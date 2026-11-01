import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TidySessionView } from './tidy.view';
import { TidySettings } from './tidy-settings';

const SPACE = '00000000-0000-7000-8000-000000000001';
const SESSION = '00000000-0000-7000-8000-000000000002';
const NOW = new Date('2026-11-01T00:00:00Z');

const session = (title = '로그인 고치기') => new TidySessionView(SESSION, title, 3, 7);

describe('정리 일 요청', () => {
  test('일 요청의 칸: 판마다 requestId가 다르고 task를 몰라도 된다', () => {
    const settings = TidySettings.restore(SPACE, 1, true, NOW);
    settings.saved(session(), 3);
    const [event, ...rest] = settings.pullEvents();
    assert.equal(rest.length, 0);
    assert.equal(event?.name, 'task.task.requested');
    assert.deepEqual(event?.data, {
      requestId: `tidy:${SESSION}:3`,
      kind: 'tidy_session',
      title: '세션 정리: 로그인 고치기',
      targetKind: 'session',
      targetId: SESSION,
      baseVersion: 7,
    });
  });

  test('꺼져 있으면 저장 뒤 요청이 없다. 행이 없어도 꺼짐이다', () => {
    const off = TidySettings.restore(SPACE, 1, false, NOW);
    off.saved(session(), 3);
    assert.equal(off.pullEvents().length, 0);
    const absent = TidySettings.absent(SPACE, NOW);
    absent.saved(session(), 3);
    assert.equal(absent.pullEvents().length, 0);
    assert.equal(absent.version, 0);
  });

  test('쌓인 세션은 꺼져 있어도 요청하고 지금 판 번호를 쓴다', () => {
    const settings = TidySettings.absent(SPACE, NOW);
    settings.backlog([session()]);
    const [event] = settings.pullEvents();
    assert.equal(event?.data.requestId, `tidy:${SESSION}:3`);
    assert.equal(settings.changed, false, '요청은 설정을 바꾸지 않는다');
  });

  test('제목이 없거나 길어도 작업 제목의 상한 안에 든다', () => {
    const settings = TidySettings.absent(SPACE, NOW);
    settings.backlog([session(''), session('ㄱ'.repeat(500))]);
    const [untitled, long] = settings.pullEvents();
    assert.equal(untitled?.data.title, '세션 정리: 제목 없음');
    assert.equal(String(long?.data.title).length, 200);
  });
});
