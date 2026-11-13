import { BaseEntity, type ColumnRules, RuleViolation, TableEntity } from '../../platform';
import type { GoalRoundNew, GoalRoundRow } from '../task.tables';
import { GoalRoundView } from './goal-run.view';

// 회차 보고 하나 (task.goal_rounds, 추가만). 팀장 에이전트가 회차 작업을 끝내기 전에 report_round로 남긴다.
// 이 보고가 주인의 결재문이 되고, 다음 회차의 지시에 실려 이어진다. 완료 여부는 팀장의 주장일 뿐이고
// 완료는 주인의 최종 결재로만 된다 (GoalRun).
export class GoalRound extends TableEntity<GoalRoundRow, GoalRoundNew> {
  static readonly SUMMARY_MAX = 4000;
  static readonly ITEMS_MAX = 30;
  static readonly ITEM_MAX = 500;
  static readonly PLAN_MAX = 2000;
  static readonly EVIDENCE_MAX = 30;

  private static readonly RULES: ColumnRules<GoalRoundRow> = {
    summary: (value) => {
      const text = value.trim();
      if (text.length < 1 || text.length > GoalRound.SUMMARY_MAX)
        throw new RuleViolation(`요약은 1~${GoalRound.SUMMARY_MAX}자예요`);
      return text;
    },
    completed: (value) => GoalRound.items('한 일', value),
    remaining: (value) => GoalRound.items('남은 일', value),
    next_plan: (value) => {
      if (value.length > GoalRound.PLAN_MAX)
        throw new RuleViolation(`다음 계획은 ${GoalRound.PLAN_MAX}자까지예요`);
      return value.trim();
    },
    evidence: (value) => {
      if (!Array.isArray(value) || value.length > GoalRound.EVIDENCE_MAX)
        throw new RuleViolation(`근거는 ${GoalRound.EVIDENCE_MAX}개까지예요`);
      return value;
    },
    done: (value) => value,
    milestone: (value) => value,
  };

  /** 이번 회차의 보고. 칸의 규칙은 RULES */
  static report(
    spaceId: string,
    runId: string,
    round: number,
    taskId: string,
    fields: Partial<GoalRoundRow>,
    now: Date,
  ): GoalRound {
    const report = new GoalRound(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        run_id: runId,
        round,
        task_id: taskId,
        summary: '',
        done: false,
        milestone: false,
        created_at: now,
      },
      true,
    );
    report.accept(fields, GoalRound.RULES);
    return report;
  }

  static restore(row: GoalRoundRow): GoalRound {
    return new GoalRound(row);
  }

  get done(): boolean {
    return this.row.done;
  }

  get milestone(): boolean {
    return this.row.milestone;
  }

  get summary(): string {
    return this.row.summary;
  }

  /** 앞 회차보다 나아갔는가: 한 일이 있거나 남은 일이 줄었다 */
  progressedFrom(previous: GoalRound | null): boolean {
    if (previous === null) return true;
    return (
      this.row.completed.length > 0 || this.row.remaining.length < previous.row.remaining.length
    );
  }

  /** 다음 회차의 지시에 싣는 앞 회차 보고 */
  brief(): string {
    const r = this.row;
    const list = (items: readonly string[]) => items.map((i) => `- ${i}`).join('\n') || '- 없음';
    return [
      `## 앞 회차(${r.round}회차) 보고`,
      r.summary,
      '### 한 일',
      list(r.completed),
      '### 남은 일',
      list(r.remaining),
      ...(r.next_plan ? ['### 다음 계획', r.next_plan] : []),
    ].join('\n');
  }

  view(): GoalRoundView {
    return new GoalRoundView(this.row);
  }

  private static items(name: string, value: readonly string[]): readonly string[] {
    const items = value.map((i) => i.trim()).filter(Boolean);
    if (items.length > GoalRound.ITEMS_MAX)
      throw new RuleViolation(`${name}은 ${GoalRound.ITEMS_MAX}개까지예요`);
    if (items.some((i) => i.length > GoalRound.ITEM_MAX))
      throw new RuleViolation(`${name} 하나는 ${GoalRound.ITEM_MAX}자까지예요`);
    return items;
  }
}
