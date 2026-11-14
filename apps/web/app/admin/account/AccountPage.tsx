'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Owner } from '../../_account/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useNotify } from '../../_ui/notify';
import { AccountForm } from './AccountForm';
import { LinkedLogins } from './LinkedLogins';
import { ProfileForm } from './ProfileForm';

// 계정: 표시 이름, 비밀번호, 연결된 로그인. 이름을 저장하면 콘솔 틀(메뉴 아래 이름)도 서버에서 다시 그린다
export function AccountPage({ owner: first, error }: { owner: Owner; error: string | null }) {
  const notify = useNotify();
  const router = useRouter();
  const [owner, setOwner] = useState(first);
  const save = useAction();

  async function rename(displayName: string) {
    const reply = await save.run(
      'rename',
      () => api<Owner>('PUT', '/api/auth/me/profile', { displayName, version: owner.version }),
      {
        done: '이름 저장됨',
        conflict: '다른 곳에서 먼저 바뀌었어요. 새로 고친 뒤 다시 저장해 주세요',
      },
    );
    if (!reply?.ok) return;
    setOwner(reply.data);
    router.refresh();
  }

  return (
    <section className="console-inner narrow" aria-label="계정">
      <header className="page-head">
        <h1>계정</h1>
        <small>{owner.login}(으)로 로그인함</small>
      </header>
      {error && <p className="error">{error}</p>}
      <ProfileForm
        key={owner.version}
        owner={owner}
        busy={save.busy !== null}
        problem={save.problem}
        onSubmit={rename}
      />
      <AccountForm onChanged={() => notify('비밀번호를 바꾸고 다른 기기의 로그인을 끝냈어요')} />
      <LinkedLogins onMessage={notify} />
    </section>
  );
}
