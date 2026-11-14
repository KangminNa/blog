'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { useLiveValue } from '../_lib/use-live';
import { LOGGED_IN_NOTE } from './labels';
import type { Approval, BrowserClick, BrowserShot, BrowserShots } from './types';

// browser-tabs 패키지의 결재 두 가지 (2차 3단계 서버 브라우저 목표). 무엇을 결재하는지는 패키지가 기록한 것을 읽는다 (에이전트의 메모가 아니라).
//   결재된 클릭(browser.site.publish, 대상 browser_click): 페이지 · 버튼 · 멈춘 화면(버튼 자리에 테두리). 승인하면 러너가 같은 버튼인지 보고 누른다
//   로그인 필요(browser.site.login, 대상 browser_site): 로그인 화면. 콘솔 화면에서 로그인한 뒤 "로그인했어요"(수정 요청)로 같은 작업을 잇는다

const BROWSER_PAGE = '/admin/p/browser-tabs';
const CLICK_STATUS: Record<string, string> = {
  held: '결재 대기',
  approved: '누를 차례',
  clicking: '누르는 중',
  clicked: '눌렀음',
  changed: '바뀌어 누르지 않음',
  unknown: '눌렸는지 모름',
  dropped: '닫힘',
  manual: '직접 처리',
};

/** 화면 그림 위에 버튼 자리를 테두리로 (자리는 보이는 화면의 CSS 픽셀, 그림은 그 화면 그대로) */
function MarkedShot({
  image,
  box,
  label,
}: {
  image: string;
  box: { x: number; y: number; width: number; height: number } | null;
  label: string;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div style={{ position: 'relative' }}>
      {/* biome-ignore lint/performance/noImgElement: 관리자만 보는 화면 그림(base64)이라 Next의 이미지 최적화를 거치지 않는다 */}
      <img
        src={`data:image/jpeg;base64,${image}`}
        alt={label}
        style={{ display: 'block', width: '100%', height: 'auto' }}
        onLoad={(e) =>
          setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        }
      />
      {box && size && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: pct(box.x, size.width),
            top: pct(box.y, size.height),
            width: pct(box.width, size.width),
            height: pct(box.height, size.height),
            outline: '3px solid currentColor',
            outlineOffset: 2,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

/** browser.site.publish: 러너가 붙잡은 페이지 · 버튼 · 멈춘 화면 */
export function ClickTarget({ approval }: { approval: Approval }) {
  const { id, version } = approval.target;
  const { data: click, error } = useLiveValue(
    `browser-click:${id}`,
    () => api<BrowserClick>('GET', `/api/p/browser-tabs/clicks/${id}`),
    [],
  );
  if (error) return <p className="error">{error}</p>;
  if (!click) return <p className="label-mono">클릭 불러오는 중…</p>;
  return (
    <section className="preview" aria-label="누를 버튼">
      <b>{click.pageTitle || click.pageUrl}</b>
      {click.version !== version && click.status === 'held' && (
        <p className="warn">결재 뒤 다시 붙잡은 클릭이에요. 승인해도 누르지 않아요</p>
      )}
      <dl className="kv">
        <dt>사이트</dt>
        <dd>{click.siteName ?? '지운 사이트'}</dd>
        <dt>페이지</dt>
        <dd className="label-mono">{click.pageUrl}</dd>
        <dt>버튼</dt>
        <dd>
          {click.role} “{click.name}”{click.nth > 0 ? ` (${click.nth + 1}번째)` : ''}
        </dd>
        <dt>상태</dt>
        <dd>
          {CLICK_STATUS[click.status] ?? click.status}
          {click.reason ? ` · ${click.reason}` : ''}
        </dd>
      </dl>
      {click.beforeImage && (
        <MarkedShot image={click.beforeImage} box={click.box} label="멈춘 화면" />
      )}
      {click.afterImage && (
        <>
          <b>{click.afterKind === 'changed' ? '바뀐 화면' : '누른 뒤 화면'}</b>
          <MarkedShot image={click.afterImage} box={null} label="누른 뒤 화면" />
        </>
      )}
      <p className="note">
        승인하면 러너가 같은 페이지 · 같은 버튼인지 다시 확인하고 눌러요. 다르면 누르지 않고{' '}
        <Link href={BROWSER_PAGE}>브라우저 화면</Link>에서 직접 하도록 알려요 · 단계 화면{' '}
        {click.shots.filter((s) => s.kind === 'step').length}장
      </p>
    </section>
  );
}

/** browser.site.login: 러너가 만난 로그인 화면 */
export function LoginTarget({ approval }: { approval: Approval }) {
  const taskId = approval.taskId;
  const shots = useLiveValue<BrowserShots | null>(
    `browser-shots:${taskId}`,
    () =>
      taskId
        ? api<BrowserShots>('GET', `/api/p/browser-tabs/shots?taskId=${taskId}`)
        : Promise.resolve({ ok: true, data: null } as const),
    [],
  );
  const login = shots.data?.shots.filter((s) => s.kind === 'login').at(-1) ?? null;
  const shot = useLiveValue<BrowserShot | null>(
    `browser-shot:${login?.id ?? 'none'}`,
    () =>
      login
        ? api<BrowserShot>('GET', `/api/p/browser-tabs/shots/${login.id}`)
        : Promise.resolve({ ok: true, data: null } as const),
    [],
  );
  return (
    <section className="preview" aria-label="로그인 필요">
      <b>로그인이 풀렸어요</b>
      {login && <p className="label-mono">{login.url}</p>}
      {shot.data && <MarkedShot image={shot.data.image} box={null} label="로그인 화면" />}
      <p className="note">
        <Link href={BROWSER_PAGE}>브라우저 화면</Link>에서 그 사이트에 로그인(2단계 인증 포함)한 뒤
        “{LOGGED_IN_NOTE}”를 누르면 같은 작업이 처음부터 이어서 해요. 비밀번호는 어디에도 남지
        않아요
      </p>
    </section>
  );
}

/** 로그인 결재의 결정: "로그인했어요"(같은 작업을 다시 대기열로) · 반려(작업 취소) */
export function LoginDecide({
  approval,
  reload,
}: {
  approval: Approval;
  reload: () => Promise<void>;
}) {
  const action = useAction();
  const decide = (decision: 'revise' | 'reject') =>
    void action.run(
      decision,
      () =>
        api<Approval>('POST', `/api/approvals/${approval.id}/decide`, {
          version: approval.version,
          decision,
          ...(decision === 'revise' ? { note: LOGGED_IN_NOTE } : {}),
        }),
      {
        done: decision === 'revise' ? '이어서 해요' : '반려됨',
        reload,
        conflict: '이미 바뀐 결재예요. 최신 내용을 다시 읽었어요',
      },
    );
  return (
    <div className="decide">
      {action.problem && <p className="error">{action.problem}</p>}
      <div className="row">
        <button
          type="button"
          className="cta small"
          disabled={action.busy !== null}
          onClick={() => decide('revise')}
        >
          {LOGGED_IN_NOTE}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={action.busy !== null}
          onClick={() => decide('reject')}
        >
          반려
        </button>
      </div>
    </div>
  );
}
