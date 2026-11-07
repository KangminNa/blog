import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type Actor,
  AgentActor,
  ApprovedActor,
  DeviceActor,
  Forbidden,
  OwnerActor,
  RuleViolation,
} from '../../platform';
import { type LoadedPost, Post } from './post';
import { PostContent } from './post-content';
import { SlugPolicy } from './slug.policy';

// 글 주소·내용·판·공개 범위 규칙 (DB 없이).

const SPACE = '0192d2a0-0000-7000-8000-000000000001';
const owner = new OwnerActor(SPACE, '0192d2a0-0000-7000-8000-000000000002');
const writer = new DeviceActor(SPACE, '0192d2a0-0000-7000-8000-000000000003', new Set(['write']));
const now = new Date('2026-10-24T00:00:00Z');

/** 저장되어 있던 글 (지금 판은 1판 '첫 글' · '본문'). 적은 칸만 바꾼다 */
function stored(fields: Partial<LoadedPost>): Post {
  return Post.restore({
    id: 'id',
    version: 3,
    space_id: SPACE,
    slug: 'first',
    lang: 'ko',
    status: Post.DRAFT,
    title: '첫 글',
    excerpt: '본문',
    head_text: '첫 글\n본문',
    head_revision_id: 'r1',
    category_id: null,
    series_id: null,
    series_order: null,
    tags: [],
    cover_blob_hash: null,
    align: 'left',
    stone_count: 0,
    published_at: null,
    updated_at: now,
    deleted_at: null,
    purge_after: null,
    meta: {},
    main_wiki_id: null,
    head_title: '첫 글',
    head_body: '본문',
    revision_count: 1,
    ref_wiki_ids: [],
    ...fields,
  });
}

function draft(by: Actor = owner): Post {
  return Post.open(
    by,
    'first',
    PostContent.write('첫 글', '본문'),
    ['mcp'],
    'left',
    '0192d2a0-0000-7000-8000-0000000000aa',
    now,
  );
}

describe('SlugPolicy', () => {
  test('제목에서: 한글은 그대로, 빈칸·기호는 -로, 앞뒤 -는 지우고, 비면 post', () => {
    assert.equal(SlugPolicy.fromTitle('세션 저장 API 만들기!'), '세션-저장-api-만들기');
    assert.equal(SlugPolicy.fromTitle('  Hello,   World?? '), 'hello-world');
    assert.equal(SlugPolicy.fromTitle('!!!'), 'post');
    assert.equal(SlugPolicy.fromTitle('가'.repeat(100)).length, SlugPolicy.MAX);
  });

  test('사람이 정한 주소는 글자·숫자·-만', () => {
    assert.equal(SlugPolicy.check(' My-Post '), 'my-post');
    assert.throws(() => SlugPolicy.check('a b'), RuleViolation);
    assert.throws(() => SlugPolicy.check('a--b'), RuleViolation);
    assert.throws(() => SlugPolicy.check('../x'), RuleViolation);
  });

  test('겹치면: 제목에서 만든 주소는 -2, -3 …, 사람이 정한 주소는 거절', () => {
    assert.equal(SlugPolicy.pick('a', new Set(), false), 'a');
    assert.equal(SlugPolicy.pick('a', new Set(['a', 'a-2']), false), 'a-3');
    assert.throws(() => SlugPolicy.pick('a', new Set(['a']), true), /이미 쓰는 주소/);
  });
});

describe('PostContent', () => {
  test('제목은 꼭, 줄바꿈은 \\n으로', () => {
    assert.throws(() => PostContent.write('  ', ''), RuleViolation);
    assert.equal(PostContent.write(' 제목 ', 'a\r\nb').body, 'a\nb');
  });

  test('앞부분: md 문법(머리 기호·링크 주소·사진·블록 줄·구분선·코드)을 걷어 낸 글자', () => {
    const c = PostContent.write(
      '제목',
      '# 머리\n\n::: center\n가운데 **굵게**\n:::\n\n![사진](a.jpg) [링크](https://x)\n\n---\n\n> [!quote]\n> 인용\n\n```\ncode\n```',
    );
    assert.equal(c.excerpt, '머리 가운데 굵게 링크 인용');
    assert.equal(PostContent.write('제목', '가'.repeat(200)).excerpt.length, 161);
  });
});

describe('Post', () => {
  test('새 글은 임시 상태로 1판과 함께. 태그는 #·빈칸·겹침을 정리한다', () => {
    const post = Post.open(
      owner,
      'p',
      PostContent.write('제목', ''),
      ['#mcp', ' mcp ', '', 'db'],
      'center',
      '0192d2a0-0000-7000-8000-0000000000aa',
      now,
    );
    assert.equal(post.status, Post.DRAFT);
    assert.equal(post.revisionCount, 1);
    assert.deepEqual(post.tags, ['mcp', 'db']);
    assert.equal(post.align, 'center');
    assert.throws(() => draft().edit(PostContent.write('a', ''), 'p', [], 'right', owner, now));
  });

  test('고쳐 쓰기: 제목·본문이 같으면 판을 만들지 않고, 태그만 바뀌어도 저장할 것은 생긴다', () => {
    const post = stored({ tags: ['mcp'] });
    post.edit(PostContent.write('첫 글', '본문'), 'first', ['mcp'], 'left', owner, now);
    assert.equal(post.changed, false);
    post.edit(PostContent.write('첫 글', '본문'), 'first', ['db'], 'left', owner, now);
    assert.equal(post.changed, true);
    const added = () => post.addedRevision;
    assert.equal(added(), null);
    post.edit(PostContent.write('첫 글', '본문 고침'), 'first', ['db'], 'left', owner, now);
    assert.equal(added()?.seq, 2);
    assert.equal(post.revisionCount, 2);
  });

  test('판의 작성자: 주인은 user, 기기와 에이전트는 ai', () => {
    const agent = new AgentActor(SPACE, 'a', 't', new Set(['write']));
    assert.equal(draft(owner).addedRevision?.actorType, 'user');
    assert.equal(draft(writer).addedRevision?.actorType, 'ai');
    assert.equal(draft(agent).addedRevision?.actorType, 'ai');
  });

  test('에이전트도 공개된 글은 고칠 수 없고 공개 범위를 바꿀 수 없다', () => {
    const agent = new AgentActor(SPACE, 'a', 't', new Set(['write']));
    const open = (status: string) => stored({ status, published_at: now });
    for (const status of [Post.PUBLISHED, Post.UNLISTED])
      assert.throws(
        () => open(status).edit(PostContent.write('고침', ''), 'first', [], 'left', agent, now),
        Forbidden,
      );
    assert.throws(() => open(Post.DRAFT).changeStatus(Post.PUBLISHED, agent, now), Forbidden);
  });

  test('공개 범위: 처음 공개한 때가 발행일, 공개·공개 취소에 이벤트. 주인만 바꾼다', () => {
    const post = draft();
    post.pullEvents();
    post.changeStatus(Post.UNLISTED, owner, now);
    assert.equal(post.publishedAt, now);
    assert.deepEqual(post.pullEvents(), []);
    post.changeStatus(Post.PUBLISHED, owner, new Date('2026-10-25T00:00:00Z'));
    assert.equal(post.publishedAt, now);
    assert.deepEqual(
      post.pullEvents().map((e) => e.name),
      ['blog.post.published'],
    );
    post.changeStatus(Post.DRAFT, owner, now);
    assert.deepEqual(
      post.pullEvents().map((e) => e.name),
      ['blog.post.unpublished'],
    );
    assert.throws(() => post.changeStatus('secret', owner, now), RuleViolation);
    assert.throws(() => draft(writer).changeStatus(Post.PUBLISHED, writer, now), Forbidden);
  });

  test('AI 도구(글쓰기 권한)는 임시 글만 고친다. 공개된 글·휴지통은 주인만', () => {
    const post = draft(writer);
    post.edit(PostContent.write('첫 글', '고침'), 'first', [], 'left', writer, now);
    post.changeStatus(Post.PUBLISHED, owner, now);
    assert.throws(
      () => post.edit(PostContent.write('첫 글', '또'), 'first', [], 'left', writer, now),
      Forbidden,
    );
    assert.throws(() => post.trash(writer, now), Forbidden);
  });

  test('휴지통: 30일 뒤 영구 삭제 가능, 그동안은 고칠 수 없고 되살리면 공개 범위 그대로', () => {
    const post = draft();
    post.changeStatus(Post.PUBLISHED, owner, now);
    post.pullEvents();
    post.trash(owner, now);
    assert.equal(post.purgeAfter?.toISOString(), '2026-11-23T00:00:00.000Z');
    assert.deepEqual(
      post.pullEvents().map((e) => e.name),
      ['blog.post.deleted'],
    );
    assert.throws(
      () => post.edit(PostContent.write('a', ''), 'first', [], 'left', owner, now),
      /휴지통/,
    );
    post.recover(owner, now);
    assert.equal(post.status, Post.PUBLISHED);
    assert.equal(post.deletedAt, null);
    assert.throws(() => post.recover(owner, now), /휴지통에 있는 글이 아니에요/);
  });
});

describe('글 → wiki 연결', () => {
  const A = '0192d2a0-0000-7000-8000-00000000000a';
  const B = '0192d2a0-0000-7000-8000-00000000000b';
  const C = '0192d2a0-0000-7000-8000-00000000000c';
  const agent = new AgentActor(SPACE, 'a', 't', new Set(['write']));
  const linked = (status: string, main: string | null = A, refs: readonly string[] = [B]) =>
    stored({ status, published_at: now, main_wiki_id: main, ref_wiki_ids: refs });

  test('보내지 않은 칸은 그대로, 대표 null과 참고 []는 비우기', () => {
    const post = linked(Post.DRAFT);
    post.linkWikis(undefined, undefined, owner, now);
    assert.equal(post.changed, false);
    post.linkWikis(undefined, [C], owner, now);
    assert.equal(post.mainWikiId, A);
    assert.deepEqual(post.refWikiIds, [C]);
    post.linkWikis(null, undefined, owner, now);
    assert.equal(post.mainWikiId, null);
    assert.deepEqual(post.refWikiIds, [C]);
    post.linkWikis(undefined, [], owner, now);
    assert.deepEqual(post.refWikiIds, []);
  });

  test('겹치는 참고와 대표와 같은 참고는 빠지고, 대표로 옮긴 참고도 빠진다', () => {
    const post = linked(Post.DRAFT, null, []);
    post.linkWikis(A, [C, B, B, A], owner, now);
    assert.deepEqual(post.refWikiIds, [B, C]);
    post.linkWikis(B, undefined, owner, now);
    assert.equal(post.mainWikiId, B);
    assert.deepEqual(post.refWikiIds, [C]);
  });

  test('같은 연결이면 바뀐 것이 없고, 보낸 순서만 달라도 그렇다', () => {
    const post = linked(Post.PUBLISHED, A, [B, C]);
    post.linkWikis(A, [C, B], owner, now);
    assert.equal(post.changed, false);
    assert.deepEqual(post.pullEvents(), []);
  });

  test('연결은 판을 쌓지 않는다. 공개 글이면 연결만 바꿔도 알린다', () => {
    const post = linked(Post.PUBLISHED);
    post.linkWikis(B, [], owner, now);
    assert.equal(post.changed, true);
    assert.equal(post.addedRevision, null);
    assert.equal(post.revisionCount, 1);
    const [event, ...rest] = post.pullEvents();
    assert.equal(rest.length, 0);
    assert.equal(event?.name, 'blog.post.updated');
    assert.equal(event?.data.mainWikiId, B);
    assert.deepEqual(event?.data.refWikiIds, []);
    assert.equal(event?.data.postVersion, 4);
  });

  test('임시 글과 링크만 글은 연결을 바꿔도 알리지 않는다', () => {
    for (const status of [Post.DRAFT, Post.UNLISTED]) {
      const post = linked(status);
      post.linkWikis(B, [], owner, now);
      assert.deepEqual(post.pullEvents(), []);
    }
  });

  test('한 번의 저장에 내용과 연결이 함께 바뀌면 이벤트는 마지막 모습 하나다', () => {
    const post = linked(Post.PUBLISHED);
    post.edit(PostContent.write('고친 제목', '본문'), 'moved', [], 'left', owner, now);
    post.linkWikis(C, [], owner, now);
    const events = post.pullEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.data.title, '고친 제목');
    assert.equal(events[0]?.data.slug, 'moved');
    assert.equal(events[0]?.data.mainWikiId, C);
  });

  test('공개·공개 취소·휴지통 이벤트에도 연결이 실린다', () => {
    const post = linked(Post.DRAFT);
    post.changeStatus(Post.PUBLISHED, owner, now);
    post.changeStatus(Post.DRAFT, owner, now);
    post.trash(owner, now);
    for (const event of post.pullEvents()) {
      assert.equal(event.data.mainWikiId, A);
      assert.deepEqual(event.data.refWikiIds, [B]);
    }
  });

  test('AI는 임시 글만 잇고, 공개된 글은 주인만. 휴지통 글은 누구도 못 바꾼다', () => {
    const draftPost = linked(Post.DRAFT);
    draftPost.linkWikis(B, [], agent, now);
    assert.equal(draftPost.mainWikiId, B);
    for (const status of [Post.PUBLISHED, Post.UNLISTED]) {
      assert.throws(() => linked(status).linkWikis(B, [], agent, now), Forbidden);
      assert.throws(() => linked(status).linkWikis(B, [], writer, now), Forbidden);
      linked(status).linkWikis(B, [], owner, now);
    }
    const trashed = linked(Post.DRAFT);
    trashed.trash(owner, now);
    assert.throws(() => trashed.linkWikis(B, [], owner, now), /휴지통/);
  });

  test('결재로 움직이는 요청자는 연결을 바꾸지 못한다', () => {
    const approved = new ApprovedActor(SPACE, String(owner.id), 'approval', Post.PUBLISH_ACTION);
    assert.throws(() => linked(Post.DRAFT).linkWikis(B, [], approved, now), Forbidden);
  });
});

describe('결재한 공개', () => {
  const APPROVAL = '0192d2a0-0000-7000-8000-0000000000b1';
  const approved = new ApprovedActor(SPACE, String(owner.id), APPROVAL, Post.PUBLISH_ACTION);
  const later = new Date('2026-10-30T00:00:00Z');
  const saved = (status: string, publishedAt: Date | null = null, deletedAt: Date | null = null) =>
    stored({ status, published_at: publishedAt, deleted_at: deletedAt });

  test('결재한 버전 그대로면 공개하고, 원래 내용에 결재 결과를 더해 돌려준다', () => {
    const post = saved(Post.DRAFT);
    const result = post.publishApproved(approved, 3, later);
    assert.equal(post.status, Post.PUBLISHED);
    assert.equal(post.publishedAt, later);
    assert.equal(post.changed, true);
    assert.equal(post.addedRevision, null);
    assert.equal(result.name, 'blog.post.published');
    assert.deepEqual(result.data, {
      postId: 'id',
      slug: 'first',
      title: '첫 글',
      status: Post.PUBLISHED,
      postVersion: 4,
      mainWikiId: null,
      refWikiIds: [],
      approvalId: APPROVAL,
      outcome: 'done',
    });
  });

  test('한 번 내렸던 글은 처음 공개한 때가 발행일이다', () => {
    const post = saved(Post.DRAFT, now);
    post.publishApproved(approved, 3, later);
    assert.equal(post.publishedAt, now);
  });

  test('공개할 수 없으면 아무것도 바꾸지 않고 실패를 돌려준다', () => {
    const cases: readonly [Post, number, RegExp][] = [
      [saved(Post.DRAFT), 2, /바뀐 글이라 공개하지 않았어요 \(결재 2, 지금 3\)/],
      [saved(Post.DRAFT, null, now), 3, /휴지통/],
      [saved(Post.PUBLISHED, now), 3, /이미 공개된 글/],
    ];
    for (const [post, version, reason] of cases) {
      const status = post.status;
      const result = post.publishApproved(approved, version, later);
      assert.equal(post.status, status);
      assert.equal(post.changed, false);
      assert.equal(result.name, 'blog.post.publish_failed');
      assert.equal(result.data.approvalId, APPROVAL);
      assert.equal(result.data.outcome, 'failed');
      assert.match(String(result.data.error), reason);
    }
  });

  test('결재는 공개만 허락한다: 휴지통, 공개된 글 고치기, 공개 범위 바꾸기는 주인만', () => {
    const content = PostContent.write('고침', '');
    assert.throws(() => saved(Post.PUBLISHED, now).trash(approved, now), Forbidden);
    assert.throws(() => saved(Post.DRAFT).trash(approved, now), Forbidden);
    assert.throws(
      () => saved(Post.PUBLISHED, now).edit(content, 'first', [], 'left', approved, now),
      Forbidden,
    );
    assert.throws(
      () => saved(Post.UNLISTED, now).changeStatus(Post.DRAFT, approved, now),
      Forbidden,
    );
    assert.throws(() => saved(Post.DRAFT).changeStatus(Post.PUBLISHED, approved, now), Forbidden);
    assert.throws(() => saved(Post.DRAFT, null, now).recover(approved, now), Forbidden);
  });

  test('다른 동작의 결재, 기기, 에이전트, 주인은 이 길로 공개하지 못한다', () => {
    const agent = new AgentActor(SPACE, 'a', 't', new Set(['write']));
    const otherAction = new ApprovedActor(SPACE, String(owner.id), APPROVAL, 'sns.post.send');
    for (const by of [otherAction, writer, agent, owner]) {
      const post = saved(Post.DRAFT);
      assert.throws(() => post.publishApproved(by, 3, later), Forbidden);
      assert.equal(post.status, Post.DRAFT);
    }
  });

  test('기기와 에이전트는 공개 범위도 바꾸지 못한다', () => {
    const agent = new AgentActor(SPACE, 'a', 't', new Set(['write']));
    for (const by of [writer, agent])
      assert.throws(() => saved(Post.DRAFT).changeStatus(Post.PUBLISHED, by, now), Forbidden);
  });

  test('사람의 공개에는 결재 결과가 붙지 않는다', () => {
    const post = saved(Post.DRAFT);
    post.changeStatus(Post.PUBLISHED, owner, now);
    const [event] = post.pullEvents();
    assert.equal(event?.name, 'blog.post.published');
    assert.deepEqual(Object.keys(event?.data ?? {}), [
      'postId',
      'slug',
      'title',
      'status',
      'postVersion',
      'mainWikiId',
      'refWikiIds',
    ]);
  });

  test('다시 낼 결과는 처음 결과와 같다', () => {
    const result = saved(Post.DRAFT).publishApproved(approved, 3, later);
    const stored = JSON.parse(JSON.stringify(result.toJSON()));
    assert.deepEqual(Post.sameResult(SPACE, stored).toJSON(), result.toJSON());
  });
});
