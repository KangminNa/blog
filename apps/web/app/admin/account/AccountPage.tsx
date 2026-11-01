'use client';

import { useNotify } from '../AdminShell';
import { AccountForm } from './AccountForm';
import { LinkedLogins } from './LinkedLogins';

export function AccountPage({ login, error }: { login: string; error: string | null }) {
  const notify = useNotify();
  return (
    <section className="console-inner narrow" aria-label="계정">
      <header className="page-head">
        <h1>계정</h1>
        <small>{login}(으)로 로그인함</small>
      </header>
      {error && <p className="error">{error}</p>}
      <AccountForm onChanged={() => notify('비밀번호를 바꾸고 다른 기기의 로그인을 끝냈어요')} />
      <LinkedLogins onMessage={notify} />
    </section>
  );
}
