import type { RunnerChoice } from '../../_task/live';

// 에이전트 폼의 "실행 러너" 칸. 정하면 그 러너만 이 에이전트의 일을 빌린다 (서버 Agent.edit의 runner).
// 코드 · 만들기 권한이 있으면 코드 러너 칸에서만 돌아 고를 수 없다 (서버도 막는다).
export function RunnerField({
  id,
  value,
  sandboxed,
  runners,
  onChange,
}: {
  id: string;
  value: string;
  sandboxed: boolean;
  runners: readonly RunnerChoice[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>실행 러너</label>
      <select
        id={id}
        className="input"
        value={sandboxed ? '' : value}
        disabled={sandboxed}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">아무 러너</option>
        {runners.map(({ runner, device }) => (
          <option key={runner.id} value={runner.id}>
            {device.name}
            {runner.online ? '' : ' (연결 안 됨)'}
          </option>
        ))}
      </select>
      <small id={`${id}-help`}>
        {sandboxed
          ? '코드 · 만들기 권한이 있으면 샌드박스에서만 돌아요'
          : '정하면 이 러너만 이 에이전트의 일을 해요 (꺼져 있으면 일이 기다려요). 내 컴퓨터 러너가 나눈 폴더는 그 러너에 묶인 에이전트만 읽어요'}
      </small>
    </div>
  );
}
