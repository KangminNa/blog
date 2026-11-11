import type { Job } from './job';
import type { RunEnding } from './job-run';
import type { RunEvent } from './progress';
import type { Redactor } from './redactor';
import type { SandboxRoom } from './sandbox-room';

/**
 * 코드 러너 칸에서 하는 일의 앞뒤 (JobRun이 AI 앞뒤에서 부르고, 그동안에도 보고 고리를 돌려 임대를 늘리고 취소를 듣는다).
 * 저장소를 고치는 일은 CodeStage, 파일을 만드는 일은 MakeStage
 */
export interface SandboxStage {
  /** AI CLI의 자리를 만들 곳 (prepare 뒤) */
  readonly workspaceRoom: SandboxRoom | null;
  /** 바깥(저장소 · 서버)에 닿지 못해 일을 돌려줬는가 (러너가 쉬었다 다시 빌린다) */
  readonly unreachable: boolean;
  /** 결과물을 올린 뒤 결재를 올릴 차례인가 (JobRun이 requestApproval을 부른다) */
  readonly awaitsApproval: boolean;
  /** 올린 결과물이 하나도 없으면 실패인가 (만들기 작업) */
  readonly needsOutputs: boolean;
  /** AI에게 줄 일: 이 단계가 아는 단락(저장소 · 재료)을 더한다 */
  aiJob(): Job;
  /** AI 전에. 끝낼 이유가 생기면 그 끝, 아니면 null */
  prepare(
    signal: AbortSignal,
    note: (event: RunEvent) => void,
    redactor: Redactor,
  ): Promise<RunEnding | null>;
  /** AI가 잘 끝난 뒤. AI의 마지막 답(요약)과 함께 결과를 만든다 */
  finish(
    summary: string,
    signal: AbortSignal,
    note: (event: RunEvent) => void,
    redactor: Redactor,
  ): Promise<RunEnding>;
  /** 결과물 뒤에 올릴 결재. 올리면 null, 못 올리면 실패로 끝낼 그 끝 */
  requestApproval(signal: AbortSignal, redactor: Redactor): Promise<RunEnding | null>;
  /** 자리를 지운다 (agent 프로세스를 모두 끈 뒤) */
  close(): Promise<void>;
}
