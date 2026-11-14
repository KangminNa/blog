import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NoticeCatalog, NoticeKind } from '../platform';

// task가 알리는 것 (7단계). 무엇을 알릴지는 알리는 모듈이 정하고 platform의 NoticeCatalog에 등록한다.
//   결재 요청(즉시): 결재가 끝나면(승인 · 거절 · 고쳐 달라 · 취소) 그 알림을 읽음으로
//   작업 실패(즉시)
//   스케줄 한도(기록만): ScheduleService가 하루 한도로 건너뛸 때 바로 남긴다
@Injectable()
export class TaskNotices implements OnModuleInit {
  static readonly APPROVAL = 'task.approval.requested';
  static readonly FAILED = 'task.task.failed';
  static readonly SCHEDULE_SKIPPED = 'task.schedule.skipped';
  private static readonly APPROVAL_ENDED = [
    'task.approval.granted',
    'task.approval.rejected',
    'task.approval.revision_requested',
    'task.approval.cancelled',
  ];
  private static readonly BODY_MAX = 300;
  /** 결과 카드의 동작 (Approval.CARD. 알림 등록은 결재 엔티티를 가져오지 않는다) */
  private static readonly CARD = 'task.chat.result';

  constructor(private readonly catalog: NoticeCatalog) {}

  onModuleInit(): void {
    this.catalog.define(
      new NoticeKind(TaskNotices.APPROVAL, '결재 요청', NoticeKind.IMMEDIATE)
        // 대화의 일에서 올라온 결재(chatId)는 따로 알리지 않는다: 결과 카드(task.chat.result)가 생길 때 한 번 (2차 2단계)
        .from(['task.approval.requested'], (e) =>
          e.data.chatId
            ? null
            : {
                title:
                  e.data.action === TaskNotices.CARD ? '결과를 골라 주세요' : '결재를 기다려요',
                body: [e.data.note, e.data.action]
                  .filter((v) => typeof v === 'string' && v !== '')
                  .join(' · ')
                  .slice(0, TaskNotices.BODY_MAX),
                link:
                  e.data.action === TaskNotices.CARD
                    ? `/admin/chats/${e.data.targetId}`
                    : '/admin/approvals',
                group_key: `approval:${e.data.approvalId}`,
                data: { approvalId: e.data.approvalId, taskId: e.data.taskId },
              },
        )
        .settledOn(TaskNotices.APPROVAL_ENDED, (e) => `approval:${e.data.approvalId}`),
    );
    this.catalog.define(
      new NoticeKind(TaskNotices.FAILED, '작업 실패', NoticeKind.IMMEDIATE).from(
        ['task.task.changed'],
        (e) =>
          e.data.status !== 'failed'
            ? null
            : {
                title: `작업이 실패했어요: ${String(e.data.title ?? '')}`.slice(0, 200),
                body: String(e.data.error ?? '').slice(0, TaskNotices.BODY_MAX),
                link: `/admin/tasks/${e.data.taskId}`,
                group_key: `task-failed:${e.data.taskId}`,
                data: { taskId: e.data.taskId },
              },
      ),
    );
    this.catalog.define(
      new NoticeKind(TaskNotices.SCHEDULE_SKIPPED, '스케줄 한도', NoticeKind.LOG),
    );
  }
}
