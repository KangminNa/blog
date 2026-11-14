// 서버 브라우저 화면의 지금 상태 한 줄 (2026-11-14): 보는 중 · 멈춤(이 창이 가려져 그리지 않음) · 꺼짐(이유).
// 꺼져 있으면 화면은 10초마다만 다시 묻는다. "다시 보기"는 바로 한 번 묻는다.

export function ScreenStatus({
  problem,
  hidden,
  retry,
}: {
  problem: string | null;
  hidden: boolean;
  retry: () => void;
}) {
  if (problem)
    return (
      <div className="row" role="status">
        <p className="error">꺼짐: {problem}</p>
        <button type="button" className="ghost small" onClick={retry}>
          다시 보기
        </button>
      </div>
    );
  return (
    <p className="note" role="status">
      {hidden ? '멈춤 (창이 가려짐)' : '보는 중'}
    </p>
  );
}
