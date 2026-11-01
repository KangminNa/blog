import { serverGet } from '../../_lib/server-api';
import { Slot } from '../../_plugins/Slot';

// 오피스: 화면은 office 플러그인이 그린다(task.office 자리). 꺼져 있으면 켜는 곳으로 안내한다.
export default async function OfficePage() {
  const on = await serverGet<object>('/api/plugins/office/settings');
  return (
    <section className="console-inner wide" aria-label="오피스">
      <header className="page-head">
        <h1>오피스</h1>
      </header>
      {on ? (
        <Slot name="task.office" context={{}} />
      ) : (
        <div className="panel">
          <b>오피스 꺼짐</b>
          <p className="note">플러그인에서 office를 켜면 표시</p>
          <a className="cta small fit" href="/admin/plugins">
            플러그인 열기
          </a>
        </div>
      )}
    </section>
  );
}
