import type { PullView } from '../../../../plugins/code-github/server/views';
import type { AgentListView, AgentView } from '../../../server/src/modules/task/agent/agent.view';
import type { AiTestView, AiToolListView } from '../../../server/src/modules/task/ai/ai-login.view';
import type {
  ApprovalPageView,
  ApprovalView,
} from '../../../server/src/modules/task/approval/approval.view';
import type { GoalListView, GoalView } from '../../../server/src/modules/task/goal/goal.view';
import type {
  GoalRunDetailView,
  GoalRunListView,
} from '../../../server/src/modules/task/goal-run/goal-run.view';
import type {
  OutputPageView,
  OutputSavedView,
} from '../../../server/src/modules/task/output/output.view';
import type {
  RunnerListView,
  RunnerView,
} from '../../../server/src/modules/task/runner/runner.view';
import type {
  ScheduleListView,
  ScheduleView,
} from '../../../server/src/modules/task/schedule/schedule.view';
import type {
  SkillDetailView,
  SkillListView,
  SkillSavedView,
} from '../../../server/src/modules/task/skill/skill.view';
import type {
  TaskDetailView,
  TaskPageView,
  TaskView,
} from '../../../server/src/modules/task/task/task.view';
import type { UsageView } from '../../../server/src/modules/task/usage/usage.view';

// 서버가 돌려주는 모양. import 없는 view 파일의 toJSON()이 원본이다 (API설계 2장).
// 서버 코드가 웹 번들에 들어가지 않게 반드시 import type으로만 가져온다.

export type Task = ReturnType<TaskView['toJSON']>;
export type TaskPage = ReturnType<TaskPageView['toJSON']>;
export type TaskDetail = ReturnType<TaskDetailView['toJSON']>;
export type TaskEvent = TaskDetail['events'][number];
export type TaskRun = TaskDetail['runs'][number];
export type TaskOutput = TaskDetail['outputs'][number];
export type OutputPage = ReturnType<OutputPageView['toJSON']>;
export type Output = OutputPage['outputs'][number];
export type OutputUsage = OutputPage['usage'];
export type OutputSaved = ReturnType<OutputSavedView['toJSON']>;
export type Goal = ReturnType<GoalView['toJSON']>;
export type GoalList = ReturnType<GoalListView['toJSON']>;
export type GoalRunList = ReturnType<GoalRunListView['toJSON']>;
export type GoalRun = GoalRunList['runs'][number];
export type GoalRunDetail = ReturnType<GoalRunDetailView['toJSON']>;
export type GoalRound = GoalRunDetail['rounds'][number];
export type SkillList = ReturnType<SkillListView['toJSON']>;
export type SkillDetail = ReturnType<SkillDetailView['toJSON']>;
export type SkillSaved = ReturnType<SkillSavedView['toJSON']>;
export type Runner = ReturnType<RunnerView['toJSON']>;
export type RunnerList = ReturnType<RunnerListView['toJSON']>;
export type Approval = ReturnType<ApprovalView['toJSON']>;
export type ApprovalPage = ReturnType<ApprovalPageView['toJSON']>;
export type Agent = ReturnType<AgentView['toJSON']>;
export type AgentList = ReturnType<AgentListView['toJSON']>;
export type Schedule = ReturnType<ScheduleView['toJSON']>;
export type ScheduleList = ReturnType<ScheduleListView['toJSON']>;
export type Usage = ReturnType<UsageView['toJSON']>;
export type UsageAgent = Usage['agents'][number];
export type UsageWindow = Usage['plan'][number];
/** AI 도구마다의 로그인 상태 (AI 메뉴, 러너 메뉴) */
export type AiTools = ReturnType<AiToolListView['toJSON']>;
export type AiTool = AiTools['tools'][number];
/** 맡긴 연결 확인 · 웹 로그인의 작업 */
export type AiTest = ReturnType<AiTestView['toJSON']>;
/** code-github 패키지의 PR (결재 화면의 code.pr.merge 대상). 패키지의 view가 원본이다 */
export type CodePull = ReturnType<PullView['toJSON']>;
