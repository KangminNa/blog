import type { AiProcess } from './ai-process';
import { ClaudeCli } from './claude-cli';
import { CodexCli } from './codex-cli';
import type { Job } from './job';
import type { JobWorkspace } from './job-workspace';
import type { PlanWindow, RunEvent } from './progress';
import type { RunnerConfig } from './runner-config';
import type { SandboxRoom } from './sandbox-room';

/** AI CLI의 출력을 한 줄씩 실행 기록으로 바꾼다. 실행마다 새로 만든다 */
export interface AiStream {
  read(line: string): readonly RunEvent[];
  /** 끝까지 읽은 뒤 어느 기록에도 싣지 못한 것 */
  finish(): readonly RunEvent[];
  /** 마지막 답 */
  readonly finalText: string;
  /** CLI가 실패로 끝냈다면 그 이유 */
  readonly failure: string | null;
  /** 격리가 깨졌으면 그 이유 (허락하지 않은 MCP 서버, 열린 셸). 보이면 바로 끈다 */
  readonly breach: string | null;
  /** 가장 최근에 본 구독 사용률. 새로 본 것이 없으면 비어 있다 */
  takePlanUsage(): readonly PlanWindow[];
  /** CLI가 알린 모델. 모르면 null */
  readonly model: string | null;
}

/**
 * AI 도구 하나 (Claude Code, Codex). 일은 도구와 상관없이 같은 순서로 돈다 (JobRun):
 * 자리 만들기 → 띄우기 → 출력 읽기 → 바뀐 자격 되돌려 쓰기 → 끝 알리기.
 * 도구마다 다른 것만 여기에 둔다: 설정 파일, MCP를 붙이는 법, 셸을 막는 법, 출력 모양, 자격 모양.
 * 각 회사의 공식 CLI를 고치지 않고 그대로 띄운다 (구독 로그인을 쓰는 길. 기획서 2026-11-07).
 */
export interface AiTool {
  readonly id: string;
  /** 실행 파일 (실행하지 못했을 때 알리려고) */
  readonly bin: string;
  /** 작업 자리를 만들고 이 도구의 설정을 쓴다. 코드 작업이면 코드 러너 칸의 자리 안에 */
  open(job: Job, room?: SandboxRoom | null): Promise<JobWorkspace>;
  start(job: Job, workspace: JobWorkspace, onLine: (line: string) => void): AiProcess;
  stream(): AiStream;
  /** 실행하는 동안 CLI가 갱신한 자격. 바뀌지 않았으면 null */
  changedCredential(workspace: JobWorkspace): Promise<string | null>;
  /** 로그와 기록에서 지울 값 (자격 안의 토큰들) */
  readonly secrets: readonly string[];
}

// biome-ignore lint/complexity/noStaticOnlyClass: 도구 이름에서 어댑터를 고르는 한 곳
export class AiTools {
  /** 러너가 일할 줄 아는 도구 */
  static readonly SUPPORTED: readonly string[] = [ClaudeCli.TOOL, CodexCli.TOOL];

  /** 일의 도구와 받은 자격으로 어댑터를 만든다. 모르는 도구면 null */
  static for(tool: string, credential: string, config: RunnerConfig): AiTool | null {
    if (tool === ClaudeCli.TOOL)
      return new ClaudeCli(
        config.cliPath,
        credential,
        config.mcpUrl,
        config.skillsDir,
        config.browserUrl,
      );
    if (tool === CodexCli.TOOL)
      return new CodexCli(
        config.codexCliPath,
        credential,
        config.mcpUrl,
        config.skillsDir,
        config.browserUrl,
      );
    return null;
  }
}
