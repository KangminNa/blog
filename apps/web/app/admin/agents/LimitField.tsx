// 에이전트 폼의 숫자 한도 칸 하나 (월 한도 · 5시간 한도 · 구독 사용률 멈춤값). 검사는 폼이 한다
export function LimitField({
  id,
  label,
  value,
  help,
  problem,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  help: string;
  problem: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        inputMode="numeric"
        value={value}
        aria-invalid={problem !== undefined}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      />
      <small id={`${id}-help`}>{help}</small>
      {problem && <p className="error">{problem}</p>}
    </div>
  );
}
