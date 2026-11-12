'use client';

import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import type { NoticeSettings } from '../../_platform/types';
import { NoticeForm, type NoticeSettingsBody } from './NoticeForm';
import { PushBox } from './PushBox';

// 알림 설정 (7단계). 무엇을 알리는지는 모듈이 정하고(종류 목록), 여기서는 어디로 · 언제 보낼지를 정한다.
//   즉시: 바로 푸시 · 묶음: 한 시간이나 하루에 한 번 모아서 · 기록만: 알림 센터에만
//   조용한 시간에는 푸시를 미뤘다가 끝날 때 모아 보낸다 (알림 센터에는 바로 쌓인다)
export function NoticesPanel() {
  const settings = useLiveValue(
    'notice-settings',
    () => api<NoticeSettings>('GET', '/api/notice-settings'),
    [],
  );
  const save = useAction();
  const problem = save.problem ?? settings.error;

  // 저장은 패널이 돌린다: 다른 곳에서 먼저 바뀌면(409) 다시 읽어 폼이 새로 만들어져도 오류 문구가 남는다
  const submit = (body: NoticeSettingsBody) =>
    save.run('save', () => api<NoticeSettings>('PUT', '/api/notice-settings', body), {
      done: '알림 설정을 저장했어요',
      reload: settings.reload,
      conflict: '이미 바뀐 설정이에요. 최신 내용을 다시 읽었어요',
    });

  return (
    <>
      <header className="page-head">
        <h1>알림</h1>
      </header>
      <p className="note">
        결재 요청 · 작업 실패 같은 일을 알려요. 즉시 알림은 바로, 묶음은 모아서 보내고, 기록만은
        알림 센터(머리줄의 알림)에만 남아요
      </p>
      <PushBox />
      {problem && <p className="error">{problem}</p>}
      {settings.data === null ? (
        !problem && <p className="label-mono">불러오는 중…</p>
      ) : (
        <NoticeForm
          key={settings.data.version}
          settings={settings.data}
          busy={save.busy !== null}
          onSubmit={submit}
        />
      )}
    </>
  );
}
