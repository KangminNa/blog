import { Injectable } from '@nestjs/common';
import { ChangeOp } from './change-op';
import type { ChangeTarget } from './change-target';

/** 변경 하나의 판정: 바로 합치기 · 검토 · 거부, 걸린 규칙, 이유 */
export class Verdict {
  static readonly MERGE = 'merge';
  static readonly REVIEW = 'review';
  static readonly REJECT = 'reject';
  /** 느슨한 순서 */
  private static readonly ORDER: readonly string[] = [
    Verdict.MERGE,
    Verdict.REVIEW,
    Verdict.REJECT,
  ];

  constructor(
    readonly action: string,
    readonly rule: string | null,
    readonly reason: string | null,
  ) {}

  /** 관리 화면 편집과 되돌리기: 규칙을 거치지 않는다 */
  static direct(): Verdict {
    return new Verdict(Verdict.MERGE, null, null);
  }

  /** 둘 중 더 엄한 동작 */
  static stricter(a: string, b: string): string {
    return Verdict.ORDER.indexOf(a) >= Verdict.ORDER.indexOf(b) ? a : b;
  }

  /** 판정에 따른 변경의 상태 */
  get status(): string {
    if (this.action === Verdict.MERGE) return ChangeOp.APPLIED;
    return this.action === Verdict.REVIEW ? ChangeOp.WAITING : ChangeOp.REJECTED;
  }

  /** 더 엄한 판정 */
  over(other: Verdict): Verdict {
    return Verdict.stricter(this.action, other.action) === this.action ? this : other;
  }
}

/** 주인이 고른 규칙 값 (vault.review_rules). 행이 없으면 규칙의 기본값. 묶음의 크기도 함께 들고 다닌다 */
export class ReviewRules {
  constructor(
    private readonly actions: ReadonlyMap<string, string>,
    private readonly values: ReadonlyMap<string, number>,
    /** 이 묶음이 건드리는 대상 수 */
    readonly targets: number,
  ) {}

  actionOf(key: string): string | null {
    return this.actions.get(key) ?? null;
  }

  valueOf(key: string): number | null {
    return this.values.get(key) ?? null;
  }
}

// 규칙 하나: 어떤 변경에 걸리는지와 기본 동작. 규칙을 늘릴 때는 하위 클래스 하나와 ReviewPolicy.RULES 한 줄.
export abstract class ReviewRule {
  /** vault.review_rules.key */
  abstract readonly key: string;
  /** 행이 없을 때의 동작 */
  abstract readonly fallback: string;
  /** 사람이나 AI가 읽을 이유. 바로 합치면 남기지 않는다 */
  abstract readonly reason: string;
  /** 주인이 값을 바꿔도 이보다 느슨해지지 않는다 (사람이 정한 것을 AI가 덮지 못하게) */
  protected readonly floor: string = Verdict.MERGE;

  abstract applies(op: ChangeOp, target: ChangeTarget | null, rules: ReviewRules): boolean;

  verdict(rules: ReviewRules): Verdict {
    const action = Verdict.stricter(rules.actionOf(this.key) ?? this.fallback, this.floor);
    return new Verdict(action, this.key, action === Verdict.MERGE ? null : this.reason);
  }
}

/** AI가 새로 더하는 것은 바로 합친다 */
export class AddRule extends ReviewRule {
  readonly key = 'add';
  readonly fallback = Verdict.MERGE;
  readonly reason = '새로 더하는 변경이에요';

  applies(op: ChangeOp, target: ChangeTarget | null): boolean {
    return op.adds(target);
  }
}

/** AI가 만든 것을 고치는 것은 바로 합친다 */
export class EditOwnRule extends ReviewRule {
  readonly key = 'edit_own';
  readonly fallback = Verdict.MERGE;
  readonly reason = 'AI가 만든 것을 고치는 변경이에요';

  applies(op: ChangeOp, target: ChangeTarget | null): boolean {
    return op.editsOwn(target);
  }
}

/** 사람이 정한 칸·대표·연결을 건드리면 사람이 본다. 주인이 값을 바꿔도 바로 합쳐지지 않는다 */
export class HumanOwnedRule extends ReviewRule {
  readonly key = 'human_owned';
  readonly fallback = Verdict.REVIEW;
  readonly reason = '사람이 정한 내용을 바꾸는 변경이에요';
  protected override readonly floor = Verdict.REVIEW;

  applies(op: ChangeOp, target: ChangeTarget | null): boolean {
    return op.touchesHuman(target);
  }
}

/** 사람이 지운 연결은 AI가 다시 만들지 못한다 */
export class HumanDeletedRule extends ReviewRule {
  readonly key = 'human_deleted';
  readonly fallback = Verdict.REJECT;
  readonly reason = '사람이 지운 연결이에요';
  protected override readonly floor = Verdict.REVIEW;

  applies(op: ChangeOp, target: ChangeTarget | null): boolean {
    return op.revivesHumanDeleted(target);
  }
}

/** 카테고리를 만들거나 옮기는 것은 구조를 바꾸는 일이라 사람이 본다 */
export class StructureRule extends ReviewRule {
  readonly key = 'structure';
  readonly fallback = Verdict.REVIEW;
  readonly reason = '카테고리 구조를 바꾸는 변경이에요';

  applies(op: ChangeOp): boolean {
    return op.changesStructure;
  }
}

/** AI가 본 뒤에 대상이 바뀌었으면 덮지 않고 제안으로 (먼저 온 것 적용, 나중 것은 제안) */
export class StaleRule extends ReviewRule {
  readonly key = 'stale';
  readonly fallback = Verdict.REVIEW;
  readonly reason = 'AI가 본 뒤에 대상이 바뀌었어요';
  protected override readonly floor = Verdict.REVIEW;

  applies(op: ChangeOp): boolean {
    return op.stale;
  }
}

/** 큰 묶음은 한 건씩 맞아도 사람이 본다 */
export class LargeSetRule extends ReviewRule {
  private static readonly DEFAULT_TARGETS = 50;
  readonly key = 'large_set';
  readonly fallback = Verdict.REVIEW;
  readonly reason = '한 번에 바꾸는 대상이 많아요';

  applies(_op: ChangeOp, _target: ChangeTarget | null, rules: ReviewRules): boolean {
    return rules.targets >= (rules.valueOf(this.key) ?? LargeSetRule.DEFAULT_TARGETS);
  }
}

/** AI는 공개 여부를 정하지 못한다. 주인이 값을 바꿔도 풀리지 않는다 */
export class PublishRule extends ReviewRule {
  readonly key = 'publish';
  readonly fallback = Verdict.REJECT;
  readonly reason = 'AI는 공개 여부를 정할 수 없어요';
  protected override readonly floor = Verdict.REJECT;

  applies(op: ChangeOp): boolean {
    return op.asksPublish;
  }
}

/** 대상이나 가리킨 점이 없다. 규칙 값으로 바꿀 수 없다 */
export class MissingTargetRule extends ReviewRule {
  readonly key = 'missing';
  readonly fallback = Verdict.REJECT;
  readonly reason = '대상을 찾을 수 없어요';
  protected override readonly floor = Verdict.REJECT;

  applies(op: ChangeOp): boolean {
    return op.missing;
  }
}

// AI 변경의 바로 합치기 · 검토 · 거부를 정하는 단 한 곳. 걸린 규칙 중 가장 엄한 것이 판정이다.
// 규칙의 뜻은 코드에, 주인이 고른 값은 vault.review_rules에 있다 (GitHub의 보호 브랜치처럼 고르는 설정이지 코드가 아니다).
@Injectable()
export class ReviewPolicy {
  private static readonly RULES: readonly ReviewRule[] = [
    new AddRule(),
    new EditOwnRule(),
    new HumanOwnedRule(),
    new HumanDeletedRule(),
    new StructureRule(),
    new StaleRule(),
    new LargeSetRule(),
    new PublishRule(),
    new MissingTargetRule(),
  ];

  judge(op: ChangeOp, target: ChangeTarget | null, rules: ReviewRules): Verdict {
    const hits = ReviewPolicy.RULES.filter((rule) => rule.applies(op, target, rules));
    const verdicts = hits.map((rule) => rule.verdict(rules));
    // 걸리는 규칙이 없는 변경은 없어야 한다. 만에 하나 있으면 합치지 않고 사람이 본다
    return verdicts.reduce(
      (strictest, v) => strictest.over(v),
      verdicts[0] ?? new Verdict(Verdict.REVIEW, null, '판정할 규칙이 없어요'),
    );
  }
}
