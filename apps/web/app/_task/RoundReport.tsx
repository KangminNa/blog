import Link from 'next/link';
import { when } from './labels';
import type { GoalRound } from './types';

/** 근거 주소는 AI가 적었다. 서버도 거르지만 화면도 http · https만 링크로 그린다 */
const WEB_LINK = /^https?:\/\//i;

// 목표 실행의 회차 보고 하나: 결재문(결재 화면)과 목표 실행 화면이 함께 쓴다.
// 보고는 팀장(AI)이 쓴 글이다. 판단은 주인이 하고, 링크는 새 탭에서 연다.
export function RoundReport({ round }: { round: GoalRound }) {
  return (
    <div className="stack">
      <p className="text">{round.summary}</p>
      <dl className="kv">
        <dt>한 일</dt>
        <dd>
          <Items items={round.completed} empty="없음" />
        </dd>
        <dt>남은 일</dt>
        <dd>
          <Items items={round.remaining} empty={round.done ? '없음 (다 됐다고 보고)' : '없음'} />
        </dd>
        {round.nextPlan && (
          <>
            <dt>다음 계획</dt>
            <dd className="text">{round.nextPlan}</dd>
          </>
        )}
        {round.evidence.length > 0 && (
          <>
            <dt>근거</dt>
            <dd>
              <ul className="bullets">
                {round.evidence.map((e, i) => (
                  // 근거는 순서만 있고 id가 없다 (보고는 고치지 않으므로 순서가 바뀌지 않는다)
                  // biome-ignore lint/suspicious/noArrayIndexKey: 추가만 하는 보고의 순서
                  <li key={i}>
                    <Evidence url={e.url} outputId={e.outputId} />
                    {e.note ? ` · ${e.note}` : ''}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>보고</dt>
        <dd>
          {when(round.createdAt)}
          {round.milestone ? ' · 중요 단계' : ''} ·{' '}
          <Link href={`/admin/tasks/${round.taskId}`}>회차 작업</Link>
        </dd>
      </dl>
    </div>
  );
}

/** 완료 조건 (주인이 맡길 때 적은 것) */
export function Criteria({ criteria }: { criteria: readonly string[] }) {
  if (criteria.length === 0) return <p className="note">완료 조건 없음: 지시만으로 판단해요</p>;
  return <Items items={criteria} empty="" />;
}

function Items({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <ul className="bullets">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 같은 글이 두 번 있을 수 있고 순서는 바뀌지 않는다
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function Evidence({ url, outputId }: { url?: string; outputId?: string }) {
  if (url && WEB_LINK.test(url))
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    );
  if (outputId)
    return (
      <a href={`/api/outputs/${outputId}/file`} download>
        결과물 {outputId.slice(0, 8)}
      </a>
    );
  return <>{url ?? ''}</>;
}
