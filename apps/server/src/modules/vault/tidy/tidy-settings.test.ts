import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TidySessionView } from './tidy.view';
import { type LoadedTidySettings, TidySettings } from './tidy-settings';

const SPACE = '00000000-0000-7000-8000-000000000001';
const SESSION = '00000000-0000-7000-8000-000000000002';

const session = (title = '로그인 고치기') =>
  new TidySessionView({ node_id: SESSION, head_title: title, revision_count: 3, version: 7 });

const settingsWith = (autoTidy: boolean) =>
  TidySettings.restore({
    id: SPACE,
    space_id: SPACE,
    version: 1,
    auto_tidy: autoTidy,
  } as LoadedTidySettings);

describe('정리 일 요청', () => {
  test('일 요청의 칸: 판마다 requestId가 다르고 task를 몰라도 된다', () => {
    const settings = settingsWith(true);
    settings.sessionSaved(session(), 3);
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
    const off = settingsWith(false);
    off.sessionSaved(session(), 3);
    assert.equal(off.pullEvents().length, 0);
    const absent = TidySettings.absent(SPACE);
    absent.sessionSaved(session(), 3);
    assert.equal(absent.pullEvents().length, 0);
    assert.equal(absent.version, 0);
  });

  test('쌓인 세션은 꺼져 있어도 요청하고 지금 판 번호를 쓴다', () => {
    const settings = TidySettings.absent(SPACE);
    settings.backlog([session()]);
    const [event] = settings.pullEvents();
    assert.equal(event?.data.requestId, `tidy:${SESSION}:3`);
    assert.deepEqual(settings.unsaved, {}, '요청은 설정을 바꾸지 않는다');
  });

  test('제목이 없거나 길어도 작업 제목의 상한 안에 든다', () => {
    const settings = TidySettings.absent(SPACE);
    settings.backlog([session(''), session('ㄱ'.repeat(500))]);
    const [untitled, long] = settings.pullEvents();
    assert.equal(untitled?.data.title, '세션 정리: 제목 없음');
    assert.equal(String(long?.data.title).length, 200);
  });
});
