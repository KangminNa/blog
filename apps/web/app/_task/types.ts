import type {
  AgentListItem,
  AgentListView,
} from '../../../server/src/modules/task/agent/agent.view';
import type {
  ApprovalPageView,
  ApprovalView,
} from '../../../server/src/modules/task/approval/approval.view';
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
export type Approval = ReturnType<ApprovalView['toJSON']>;
export type ApprovalPage = ReturnType<ApprovalPageView['toJSON']>;
export type Agent = ReturnType<AgentListItem['toJSON']>;
export type AgentList = ReturnType<AgentListView['toJSON']>;
export type Usage = ReturnType<UsageView['toJSON']>;
export type UsageAgent = Usage['agents'][number];
export type UsageWindow = Usage['plan'][number];
