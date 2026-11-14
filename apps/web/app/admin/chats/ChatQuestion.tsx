import type { ChatQuestion as Question } from '../../_task/types';

// 맡기 전의 질문 (2차 1-5): 어느 에이전트에게 맡길지. 고르면 그 에이전트가 맡고, 아래 입력 칸에 글로 답해도 된다.
// 질문의 글은 주고받음에 말풍선으로 있다 (ChatTurns): 여기는 고를 것만
// 고를 것마다 이름과 맡는 일(역할의 첫 줄). 막는 것(후보가 아님)은 서버
export function ChatQuestion({
  question,
  busy,
  onPick,
}: {
  question: Question;
  busy: boolean;
  onPick: (choice: { id: string; name: string }) => void;
}) {
  return (
    <section className="chat-question" aria-label="질문">
      {question.choices.length > 0 && (
        <ul className="choices">
          {question.choices.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={i === 0 ? 'choice first' : 'choice'}
                disabled={busy}
                onClick={() => onPick({ id: c.id, name: c.name })}
              >
                <b>{c.name}</b>
                <small>{c.role || '맡는 일 없음'}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="note">고르거나 아래에 직접 써서 답해요</p>
    </section>
  );
}
