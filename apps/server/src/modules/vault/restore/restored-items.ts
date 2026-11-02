import { ArchiveFile, type ArchiveRecord, BaseEntity } from '../../platform';
import { ChangeWork } from '../change/change-target';
import { Session } from '../session/session';
import { SessionNote } from '../session/session-note';
import { SlugPolicy } from '../slug.policy';
import type {
  CategoryRow,
  EdgeNew,
  PostMarkRow,
  SessionNew,
  SessionRevisionNew,
  WikiRevisionNew,
  WikiRow,
} from '../vault.tables';
import { Wiki } from '../wiki/wiki';
import { WikiBody } from '../wiki/wiki-body';

// 보관 파일에서 읽은 vault의 항목들. 복원은 id를 지키고 이벤트를 남기지 않아서 Session·Wiki의 open을 거치지 않지만,
// 칸·해시·찾기용 글은 저장할 때와 같은 객체(SessionNote, WikiBody)로 다시 만든다. 그래야 복원 뒤의 고치기·저장이 그대로 돈다.
// 지금 판이 첫 판이 되고(판 번호 1), 판을 만든 쪽은 system이다.
// 판 id는 파일에 없어 새로 짓는다 (지난 판은 복원하지 않는다).
// 항목마다 넣을 행을 들고 있다. 공간은 복원할 때 정해지므로 행에 없다.

const ORIGINS: readonly string[] = [ChangeWork.AI, ChangeWork.HUMAN];
const SYSTEM = 'system';

/** vault/categories.yml의 항목 하나. 출처·고정이 없는 옛 백업은 사람의 것으로 본다 (AI가 덮지 못하게) */
export class RestoredCategory extends BaseEntity {
  private constructor(
    readonly row: Omit<CategoryRow, 'space_id' | 'version' | 'meta'>,
    readonly createdAt: Date,
  ) {
    super(row.node_id, 1);
  }

  static read(record: ArchiveRecord): RestoredCategory {
    return new RestoredCategory(
      {
        node_id: record.id(),
        name: record.text('name'),
        slug: record.attempt(() => SlugPolicy.check(record.text('slug'))),
        color: record.optionalText('color'),
        description: record.optionalText('description'),
        sort: record.number('sort'),
        origin: record.has('origin') ? record.oneOf('origin', ORIGINS) : ChangeWork.HUMAN,
        pinned: record.flag('pinned', true),
      },
      record.createdAt,
    );
  }
}

/** vault/wikis/<주소>.md 하나. 주소는 파일 이름이다 */
export class RestoredWiki extends BaseEntity {
  private static readonly KNOWN: ReadonlySet<string> = new Set([
    'cairn_format',
    'cairn_type',
    'cairn_id',
    'title',
    'visibility',
    'cairn_category',
    'cairn_origin',
    'cairn_pinned',
  ]);

  private constructor(
    readonly row: Omit<WikiRow, 'space_id' | 'version'>,
    readonly revision: WikiRevisionNew,
  ) {
    super(row.node_id, 1);
  }

  static read(record: ArchiveRecord): RestoredWiki {
    const name = record.path.slice(record.path.lastIndexOf('/') + 1, -'.md'.length);
    const body = WikiBody.parse(record.body);
    const id = record.id();
    const revisionId = BaseEntity.newId();
    const slug = record.attempt(() => SlugPolicy.check(name));
    const title = record.text('title');
    const visibility = record.oneOf('visibility', Wiki.VISIBILITIES);
    const categoryId = record.optionalId('cairn_category');
    const origin = record.has('cairn_origin')
      ? record.oneOf('cairn_origin', ORIGINS)
      : ChangeWork.HUMAN;
    // 옛 백업에는 사람이 고친 칸의 표시가 없다. 모두 사람의 것으로 두어 AI가 바로 덮지 못하게 한다
    const pinned = record.has('cairn_pinned')
      ? record.texts('cairn_pinned')
      : [Wiki.TITLE_KEY, ...body.sections.map((s) => s.key)];
    const createdAt = record.createdAt;
    return new RestoredWiki(
      {
        node_id: id,
        category_id: categoryId,
        title,
        slug,
        visibility,
        origin,
        head_revision_id: revisionId,
        pinned_sections: pinned,
        head_text: body.markdown,
        revision_count: 1,
        created_at: createdAt,
        updated_at: createdAt,
        meta: ArchiveFile.metaOf(record.unknownKeys(RestoredWiki.KNOWN)),
      },
      {
        id: revisionId,
        wiki_id: id,
        seq: 1,
        kind: origin,
        body_md: body.markdown,
        sections: body.sections.map((s) => s.toJSON()),
        section_hashes: body.sectionHashes(),
        content_hash: body.hash,
        actor_type: SYSTEM,
        created_at: createdAt,
      },
    );
  }
}

/** vault/sessions/…/<날짜>-<주소>.md 하나 */
export class RestoredSession extends BaseEntity {
  /**
   * 기기는 복원하지 않고 내보낸 파일에도 기기 id가 없다. device_id는 값이라(외래키 없음) 이 고정 값을 넣는다.
   * 대화 id(source_session_id)도 파일에 없어 세션 id로 채운다. 세 값 모두 진짜 기기의 값과 겹칠 수 없으므로
   * 복원 뒤 기기가 저장하는 세션은 UNIQUE (공간, 기기, 도구, 대화)에 걸리지 않고 새 세션이 된다.
   * 복원 전의 대화를 다시 저장해도 그 세션의 새 판이 아니라 새 세션이 된다.
   */
  static readonly NO_DEVICE = '00000000-0000-7000-8000-000000000000';
  private static readonly VISIBILITIES: readonly string[] = [Session.PRIVATE, Session.PUBLIC];
  private static readonly ORIGIN = 'origin';
  private static readonly KNOWN: ReadonlySet<string> = new Set([
    'cairn_format',
    'cairn_type',
    'cairn_id',
    'title',
    'visibility',
    'tool',
    'started',
    'cairn_wiki',
    'cairn_pinned',
    'project',
    'tags',
  ]);

  private constructor(
    readonly row: Omit<SessionNew, 'space_id' | 'wiki_id'>,
    readonly revision: SessionRevisionNew,
    /** 파일에 적힌 대표 wiki. 복원되는 wiki일 때만 쓴다 */
    readonly wikiId: string | null,
    /** 시작한 때. 파일에 없으면 지금 */
    readonly at: Date,
  ) {
    super(row.node_id, 1);
  }

  static read(record: ArchiveRecord): RestoredSession {
    const wikiId = record.optionalId('cairn_wiki');
    const id = record.id();
    const revisionId = BaseEntity.newId();
    const visibility = record.oneOf('visibility', RestoredSession.VISIBILITIES);
    const tool = record.text('tool');
    const project = record.optionalText('project');
    const started = record.date('started');
    const pinned = record.has('cairn_pinned')
      ? record.texts('cairn_pinned')
      : wikiId === null
        ? []
        : [Session.WIKI_KEY];
    const note = record.attempt(() =>
      SessionNote.write(
        record.text('title'),
        record.texts('tags'),
        RestoredSession.sections(record.body),
      ),
    );
    const meta = ArchiveFile.metaOf(record.unknownKeys(RestoredSession.KNOWN));
    const at = started ?? new Date();
    return new RestoredSession(
      {
        node_id: id,
        device_id: RestoredSession.NO_DEVICE,
        tool,
        source_session_id: id,
        project,
        visibility,
        head_revision_id: revisionId,
        head_title: note.title,
        // 본문 md 그대로. 칸은 note에서 다시 만들지만 내보낼 글은 바이트까지 지킨다
        head_text: record.body,
        revision_count: 1,
        started_at: started,
        last_revision_at: at,
        pinned_sections: pinned,
        meta,
      },
      {
        id: revisionId,
        session_id: id,
        seq: 1,
        kind: RestoredSession.ORIGIN,
        body_md: record.body,
        sections: note.toJSON(),
        sections_schema: SessionNote.SCHEMA,
        section_hashes: note.sectionHashes(),
        content_hash: note.hash,
        actor_type: SYSTEM,
        created_at: at,
      },
      wikiId,
      at,
    );
  }

  /**
   * SessionNote.toMarkdown의 반대: 고정 소제목으로 칸을 나눈다. 소제목은 정해진 순서로, 위아래가 빈 줄일 때만 칸의 시작이다.
   * 칸의 글 안에 똑같은 줄이 있으면 경계가 어긋날 수 있지만, 본문은 그대로 남아 내용은 사라지지 않는다.
   */
  private static sections(body: string): ReadonlyMap<string, string> {
    const lines = body.split('\n');
    const found = new Map<string, string[]>();
    let current: string[] | null = null;
    let next = 0;
    lines.forEach((line, i) => {
      const at = SessionNote.SECTIONS.findIndex(
        ([, heading], order) => order >= next && line === `## ${heading}`,
      );
      const alone = at >= 0 && (lines[i - 1] ?? '') === '' && (lines[i + 1] ?? '') === '';
      if (!alone) {
        current?.push(line);
        return;
      }
      current = [];
      found.set(SessionNote.SECTIONS[at]?.[0] ?? '', current);
      next = at + 1;
    });
    return new Map([...found].map(([name, text]) => [name, text.join('\n')]));
  }
}

/** vault/graph.json의 선 하나. 지운 선도 행으로 돌아와 사람이 지운 선을 AI가 다시 만들지 못한다 */
export class RestoredEdge extends BaseEntity {
  private constructor(readonly row: Omit<EdgeNew, 'space_id'>) {
    super(row.id, 1);
  }

  static read(record: ArchiveRecord): RestoredEdge {
    return new RestoredEdge({
      id: record.id(),
      src: record.id('src'),
      dst: record.id('dst'),
      kind: record.text('kind'),
      weight: record.optionalNumber('weight'),
      origin: record.oneOf('origin', ORIGINS),
      pinned: record.flag('pinned', false),
      deleted_at: record.date('deleted_at'),
      deleted_by_type: record.optionalText('deleted_by'),
      actor_type: SYSTEM,
      created_at: record.createdAt,
    });
  }
}

/** vault/graph.json의 고정한 점 위치 하나 */
export class RestoredPin extends BaseEntity {
  private constructor(
    readonly view: string,
    readonly node: string,
    readonly x: number,
    readonly y: number,
  ) {
    super(`${view}/${node}`, 1);
  }

  static read(record: ArchiveRecord): RestoredPin {
    return new RestoredPin(
      record.text('view'),
      record.id('node'),
      record.number('x'),
      record.number('y'),
    );
  }
}

/**
 * 글 자리 사본 한 행. vault는 blog를 읽지 못하고 복원은 이벤트를 남기지 않으므로,
 * blog의 표나 코드가 아니라 보관 형식의 글 파일 앞부분을 읽어 채운다. 글 버전은 복원된 글의 첫 버전이다.
 */
export class RestoredPostMark extends BaseEntity {
  private static readonly PUBLISHED = 'published';
  private static readonly DRAFT = 'draft';

  private constructor(readonly row: Omit<PostMarkRow, 'space_id' | 'updated_at'>) {
    super(row.post_id, 1);
  }

  static read(record: ArchiveRecord): RestoredPostMark {
    const published = record.text('status') === RestoredPostMark.PUBLISHED;
    return new RestoredPostMark({
      post_id: record.id(),
      title: record.text('title'),
      slug: record.text('slug'),
      status: published ? RestoredPostMark.PUBLISHED : RestoredPostMark.DRAFT,
      main_wiki_id: record.optionalId('cairn_main_wiki'),
      ref_wiki_ids: record.ids('cairn_ref_wikis'),
      post_version: 1,
    });
  }
}
