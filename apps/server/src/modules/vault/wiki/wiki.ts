import { BaseEntity, DomainEvent, RuleViolation } from '../../platform';
import { type ChangeWork, GraphNode, type NewNode } from '../change/change-target';
import { SlugPolicy } from '../slug.policy';
import type { WikiNew, WikiRevisionNew, WikiRow } from '../vault.tables';
import { WikiSavedView } from './wiki.view';
import { WikiBody } from './wiki-body';

/** wikis 한 줄 + 점의 id와 휴지통 표시(vault.nodes), 지금 판의 본문(wiki_revisions) */
export interface LoadedWiki extends WikiRow {
  id: string;
  deleted_at: Date | null;
  body_md: string | null;
}

// wiki: 여러 세션을 모아 쓴 정리 문서. 본문은 판으로 쌓고, 사람이 고친 칸은 pinned_sections에 남아 AI가 바로 바꾸지 못한다.
// 판(wiki_revisions)은 추가만 한다: 고칠 때마다 덮어쓰지 않고 쌓는다.
// 새 wiki는 늘 비공개이고, 공개 여부는 사람만 바꾼다. 쓰기는 모두 변경 묶음(ChangeService)을 거친다.
export class Wiki extends GraphNode<LoadedWiki, NewNode<WikiNew>> {
  static readonly PRIVATE = 'private';
  static readonly PUBLIC = 'public';
  static readonly VISIBILITIES: readonly string[] = [Wiki.PRIVATE, Wiki.PUBLIC];
  static readonly TITLE_MAX = 200;
  /** 사람이 정한 제목을 pinned_sections에 적는 이름. 칸 이름과 겹치지 않는다 */
  static readonly TITLE_KEY = '#title';

  readonly targetKind = 'wiki';
  private added: WikiRevisionNew | null = null;

  private constructor(
    row: LoadedWiki | NewNode<WikiNew>,
    private body: WikiBody,
    fresh: boolean,
    manualSlug: boolean,
  ) {
    super(row, fresh, manualSlug);
  }

  /** 새 wiki. 비공개로 시작하고, 사람이 쓴 칸은 처음부터 사람의 것이다 */
  static open(
    work: ChangeWork,
    title: string,
    body: WikiBody,
    slug: string | null,
    categoryId: string | null,
  ): Wiki {
    const name = Wiki.checkTitle(title);
    const id = BaseEntity.newId();
    const wiki = new Wiki(
      {
        id,
        node_id: id,
        space_id: work.spaceId,
        category_id: categoryId,
        title: name,
        slug: slug === null ? SlugPolicy.fromTitle(name) || 'wiki' : SlugPolicy.check(slug),
        visibility: Wiki.PRIVATE,
        origin: work.origin,
        head_revision_id: null,
        pinned_sections: work.human ? [Wiki.TITLE_KEY, ...body.sections.map((s) => s.key)] : [],
        revision_count: 0,
        created_at: work.now,
        updated_at: work.now,
      },
      body,
      true,
      slug !== null,
    );
    wiki.addRevision(body, work);
    return wiki;
  }

  static restore(row: LoadedWiki): Wiki {
    return new Wiki(row, WikiBody.parse(row.body_md ?? ''), false, true);
  }

  get title(): string {
    return this.row.title;
  }

  /** 이번에 새로 쌓인 판 (Repository가 저장한다) */
  get addedRevision(): WikiRevisionNew | null {
    return this.added;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  revisionSaved(): void {
    this.added = null;
  }

  /** 이 제목·본문으로 바꾸면 사람이 고친 칸을 건드리는가 */
  touchesPinned(title: string, body: WikiBody): boolean {
    const keys = [
      ...body.changedFrom(this.body),
      ...(title.trim() === this.row.title ? [] : [Wiki.TITLE_KEY]),
    ];
    return keys.some((key) => this.row.pinned_sections.includes(key));
  }

  /** 제목·본문을 고친다. 본문이 다르면 새 판을 쌓고, 사람이 고쳤으면 바뀐 칸을 사람의 것으로 표시한다 */
  revise(title: string, body: WikiBody, work: ChangeWork): void {
    const name = Wiki.checkTitle(title);
    const keys = body.changedFrom(this.body);
    const renamed = name !== this.row.title;
    if (renamed) this.put('title', name);
    if (!body.sameAs(this.body)) this.addRevision(body, work);
    if (work.human) this.pin([...keys, ...(renamed ? [Wiki.TITLE_KEY] : [])]);
    if (this.changed) this.touch(work.now);
  }

  /** 공개 여부. 사람만 바꾼다 (AI는 묶음 판정에서 막히고, 여기가 마지막 벽이다) */
  setVisibility(visibility: string, work: ChangeWork): void {
    if (!work.human) throw new RuleViolation('공개 여부는 사람만 바꿔요');
    if (!Wiki.VISIBILITIES.includes(visibility))
      throw new RuleViolation(`공개 여부는 ${Wiki.VISIBILITIES.join(' · ')} 중 하나예요`);
    if (visibility === this.row.visibility) return;
    this.put('visibility', visibility);
    this.touch(work.now);
  }

  /** 대표 카테고리를 옮긴다. null이면 미분류 */
  moveTo(categoryId: string | null, work: ChangeWork): void {
    if (categoryId === this.row.category_id) return;
    this.put('category_id', categoryId);
    this.touch(work.now);
  }

  snapshot(): Readonly<Record<string, unknown>> {
    const { title, category_id, visibility, pinned_sections } = this.row;
    return {
      version: this.version,
      title,
      body_md: this.body.markdown,
      category_id,
      visibility,
      pinned_sections,
      deleted: this.gone,
    };
  }

  /** 앞 상태로 돌아간다. 판은 지우지 않고 앞 내용을 새 판으로 쌓는다. 이 묶음이 만든 wiki면 휴지통으로 */
  rollBack(before: Readonly<Record<string, unknown>> | null, work: ChangeWork): void {
    if (before === null) {
      this.moveToTrash(work.now);
      this.touch(work.now);
      return;
    }
    if (before.deleted) this.moveToTrash(work.now);
    else this.takeOutOfTrash();
    const title = String(before.title);
    if (title !== this.row.title) this.put('title', title);
    const body = WikiBody.parse(String(before.body_md));
    if (!body.sameAs(this.body)) this.addRevision(body, work);
    this.moveTo(before.category_id === null ? null : String(before.category_id), work);
    const visibility = String(before.visibility);
    if (visibility !== this.row.visibility) this.put('visibility', visibility);
    this.put('pinned_sections', before.pinned_sections as string[]);
    this.touch(work.now);
  }

  savedView(changeSetId: string): WikiSavedView {
    const { markdown, sections } = this.body;
    return new WikiSavedView({ ...this.row, body_md: markdown, sections }, changeSetId);
  }

  private addRevision(body: WikiBody, work: ChangeWork): void {
    const revision: WikiRevisionNew = {
      id: BaseEntity.newId(),
      wiki_id: this.id,
      seq: this.row.revision_count + 1,
      kind: work.origin,
      base_revision_id: this.row.head_revision_id,
      change_set_id: work.setId,
      body_md: body.markdown,
      sections: body.sections.map((s) => s.toJSON()),
      section_hashes: body.sectionHashes(),
      content_hash: body.hash,
      actor_type: work.actorType,
      actor_id: work.actorId,
      created_at: work.now,
    };
    this.added = revision;
    this.body = body;
    this.put('head_revision_id', revision.id);
    this.put('head_text', body.markdown);
    this.put('revision_count', revision.seq);
    this.record(
      new DomainEvent('vault.wiki.saved', 1, this.spaceId, {
        wikiId: this.id,
        revisionId: revision.id,
        seq: revision.seq,
        kind: revision.kind,
        changeSetId: work.setId,
      }),
    );
  }

  private pin(keys: readonly string[]): void {
    const pinned = [...new Set([...this.row.pinned_sections, ...keys])];
    if (pinned.length === this.row.pinned_sections.length) return;
    this.put('pinned_sections', pinned);
  }

  private touch(now: Date): void {
    this.put('updated_at', now);
  }

  private static checkTitle(title: string): string {
    const name = title.trim();
    if (!name) throw new RuleViolation('제목을 써 주세요');
    if (name.length > Wiki.TITLE_MAX) throw new RuleViolation(`제목은 ${Wiki.TITLE_MAX}자까지예요`);
    return name;
  }
}
