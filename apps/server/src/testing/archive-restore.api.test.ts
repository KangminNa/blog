import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  ArchiveFile,
  ArchiveQuery,
  type ArchiveReport,
  ArchiveRestoreService,
  Database,
  OutboxWorker,
  SystemActor,
  VisitorActor,
  ZipFile,
} from '../modules/platform';
import { ApiClient, type ApiResult, type TestUser } from './api-client';
import { FreshDatabase } from './fresh-database';

// 복원 (docs/보관형식.md). 진짜 데이터로 채운 Cairn을 내보내고, 새 DB의 빈 Cairn에 들여와 다시 내보내 바이트까지 비교한다.
// 테스트 전용 DB는 다른 테스트의 데이터로 차 있어서, 파일 하나가 쓰는 Cairn마다 새 DB를 만든다.

type Json = Record<string, unknown>;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const system = new SystemActor();
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const photo = (): Buffer => Buffer.concat([PNG, randomBytes(64)]);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 새 DB와 새 사진 폴더로 뜬 Cairn 하나 (설치까지 끝남) */
class Cairn {
  private constructor(
    readonly database: FreshDatabase,
    readonly blobs: string,
    readonly api: ApiClient,
    readonly owner: TestUser,
  ) {}

  static async boot(name: string): Promise<Cairn> {
    const database = await FreshDatabase.create(`cairn_restore_${name}`);
    const blobs = await mkdtemp(join(tmpdir(), 'cairn-restore-'));
    const before = process.env.CAIRN_BLOBS_DIR;
    process.env.CAIRN_BLOBS_DIR = blobs;
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;
    const api = await ApiClient.start();
    process.env.DATABASE_URL = previous;
    process.env.CAIRN_BLOBS_DIR = before;
    const owner = await api.signIn();
    const { version } = (await api.get('/api/space')).json() as { version: number };
    ok(
      await api.request('PUT', '/api/space', owner, {
        name: '돌무더기',
        siteUrl: api.baseUrl,
        version,
      }),
    );
    return new Cairn(database, blobs, api, owner);
  }

  async close(): Promise<void> {
    await this.api.close();
    await this.database.drop();
    await rm(this.blobs, { recursive: true, force: true });
  }

  get sql() {
    return this.api.service(Database).sql;
  }

  get restores(): ArchiveRestoreService {
    return this.api.service(ArchiveRestoreService);
  }

  get spaceId(): Promise<string> {
    return this.sql`SELECT id FROM account.spaces`.then(([row]) => String(row?.id));
  }

  files(): Promise<readonly ArchiveFile[]> {
    return this.api.service(ArchiveQuery).files(system);
  }

  async restore(files: readonly ArchiveFile[]): Promise<ArchiveReport> {
    return this.restores.apply(system, await this.spaceId, files);
  }

  /** 복원이 쓰는 표의 행 수. 실패한 뒤 아무것도 남지 않았는지 볼 때 */
  async rows(): Promise<number> {
    const [row] = await this.sql`
      SELECT (SELECT count(*) FROM vault.nodes) + (SELECT count(*) FROM vault.edges)
           + (SELECT count(*) FROM vault.session_revisions) + (SELECT count(*) FROM vault.wiki_revisions)
           + (SELECT count(*) FROM vault.post_marks) + (SELECT count(*) FROM blog.posts)
           + (SELECT count(*) FROM blog.post_revisions) + (SELECT count(*) FROM blog.assets)
           + (SELECT count(*) FROM blog.post_wiki_refs) AS n`;
    return Number(row?.n);
  }

  async tool(token: string, name: string, args: Json): Promise<Json> {
    const res = await this.api.mcp(token, 'tools/call', { name, arguments: args });
    assert.equal(res.status, 200, res.text);
    const result = res.json().result as { isError?: boolean; structuredContent?: Json };
    assert.notEqual(result.isError, true, res.text);
    return result.structuredContent ?? {};
  }

  /** 정리 권한까지 가진 기기 */
  tidyDevice(name: string): Promise<string> {
    return this.device(name, ['tidy', 'read_all', 'upload']);
  }

  /** 권한을 정해 연결한 기기 */
  async device(name: string, scopes: readonly string[]): Promise<string> {
    const { api, owner } = this;
    const token = await api.connectDevice(owner, name);
    const { devices } = ok(await api.get('/api/devices', owner)) as {
      devices: { id: string; name: string; version: number }[];
    };
    const device = devices.find((d) => d.name === name);
    ok(
      await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
        scopes,
        version: device?.version,
      }),
    );
    return token;
  }

  async submit(token: string, ops: Json[]): Promise<{ id: string; ops: Json[] }> {
    const body = await this.tool(token, 'submit_changes', {
      request_id: randomUUID(),
      message: '정리',
      ops,
    });
    return { id: String(body.change_set_id), ops: body.ops as Json[] };
  }

  async revert(setId: string): Promise<void> {
    const [row] = await this.sql`SELECT version FROM vault.change_sets WHERE id = ${setId}`;
    ok(
      await this.api.request('POST', `/api/changes/${setId}/revert`, this.owner, {
        version: row?.version,
      }),
    );
  }

  async post(title: string, body: string, status?: string, more: Json = {}): Promise<Json> {
    const { api, owner } = this;
    const made = ok(
      await api.request('POST', '/api/posts', owner, {
        requestId: randomUUID(),
        title,
        body,
        ...more,
      }),
      201,
    );
    if (!status) return made;
    return ok(
      await api.request('POST', `/api/posts/${made.id}/status`, owner, {
        status,
        version: made.version,
      }),
    );
  }

  async upload(postId: unknown, bytes: Buffer): Promise<void> {
    const res = await fetch(`${this.api.baseUrl}/api/posts/${postId}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', cookie: this.owner.header },
      body: new Uint8Array(bytes),
    });
    assert.equal(res.status, 201, await res.text());
  }
}

/** 원본에서 기억해 둘 것 */
class Seed {
  session = '';
  tricky = '';
  openWiki = '';
  privateWiki = '';
  aiWiki = '';
  deletedEdge: [string, string] = ['', ''];
  published = '';
  unlisted = '';
  draftPhoto: Buffer = Buffer.alloc(0);
  openPhoto: Buffer = Buffer.alloc(0);
  loosePhoto: Buffer = Buffer.alloc(0);
}

const seed = new Seed();

/** 공개·비공개 wiki, 세션, 지운 선, 임시·공개·링크만 글, 사진까지 진짜 길로 채운다 */
async function fill(c: Cairn): Promise<void> {
  const { api, owner } = c;
  const device = await api.connectDevice(owner, 'source-laptop');
  const tidy = await c.tidyDevice('source-tidy');

  const category = ok(
    await api.request('POST', '/api/categories', owner, {
      requestId: randomUUID(),
      name: '구역: 하나',
      color: '#000000',
      description: '여러 줄\n기준',
    }),
    201,
  );
  await api.request('POST', '/api/categories', owner, {
    requestId: randomUUID(),
    name: '비어 있는 구역',
  });
  const open = ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: '공개 "wiki"',
      bodyMd: '앞글\n\n## 배경\n\n[[다른 wiki]]\n\n```\n## 코드 안\n```\n\n## 배경\n\n둘째',
      categoryId: category.id,
    }),
    201,
  );
  seed.openWiki = String(open.id);
  ok(
    await api.request('PUT', `/api/wikis/${open.id}`, owner, {
      title: '공개 "wiki"',
      bodyMd: '앞글\n\n## 배경\n\n[[다른 wiki]]\n\n```\n## 코드 안\n```\n\n## 배경\n\n고친 둘째',
      visibility: 'public',
      version: open.version,
    }),
  );
  const closed = ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: '비공개 wiki',
      bodyMd: '',
    }),
    201,
  );
  seed.privateWiki = String(closed.id);

  const created = await c.submit(tidy, [
    { op: 'wiki.create', payload: { title: 'AI wiki', body_md: '## 칸\n\nAI가 쓴 글' } },
    { op: 'wiki.create', payload: { title: '휴지통 갈 wiki', body_md: '곧 지움' } },
  ]);
  const [made] = await c.sql`
    SELECT seq, target_id FROM vault.change_ops WHERE change_set_id = ${created.id} ORDER BY seq`;
  seed.aiWiki = String(made?.target_id);
  const removable = await c.submit(tidy, [
    { op: 'wiki.create', payload: { title: '되돌릴 wiki', body_md: '곧 지움' } },
  ]);
  const [gone] = await c.sql`
    SELECT target_id FROM vault.change_ops WHERE change_set_id = ${removable.id}`;

  const save = async (more: Json): Promise<string> => {
    const saved = await c.tool(device, 'save_session', {
      request_id: randomUUID(),
      source_session_id: `conv-${randomUUID()}`,
      tool: 'claude-code',
      started_at: '2026-10-31T09:40:00.000Z',
      ...more,
    });
    return String(saved.session_id);
  };
  seed.session = await save({
    project: '../위험한/프로젝트',
    title: '보관 형식 만들기',
    tags: ['백업', '보관, 쉼표'],
    did: '복원을 만들었다',
    decisions: '빈 곳에만',
    quotes: '> "그대로"',
  });
  seed.tricky = await save({
    title: '칸 소제목이 글에 든 세션',
    did: '앞\n\n## 결정\n\n본문 안의 소제목',
    extra: '기타 칸',
  });
  await save({ project: '같은 곳', title: '같은 제목', did: '하나' });
  await save({ project: '같은 곳', title: '같은 제목', did: '둘' });
  const dangling = await save({ title: '지운 wiki의 세션', did: '대표가 휴지통에 간다' });
  await c.sql`UPDATE vault.sessions SET visibility = 'public' WHERE node_id = ${seed.tricky}`;

  await c.submit(tidy, [
    { op: 'session.assign', target_id: seed.session, payload: { wiki_id: seed.openWiki } },
    { op: 'session.assign', target_id: dangling, payload: { wiki_id: gone?.target_id } },
    { op: 'edge.add', payload: { src: seed.openWiki, dst: seed.aiWiki, kind: 'link' } },
    { op: 'edge.add', payload: { src: seed.session, dst: seed.aiWiki, kind: 'material' } },
    { op: 'edge.add', payload: { src: gone?.target_id, dst: seed.aiWiki, kind: 'link' } },
  ]);
  await c.sql`UPDATE vault.sessions SET pinned_sections = '{#wiki}' WHERE node_id = ${seed.session}`;
  await c.sql`
    UPDATE vault.edges SET weight = 0.37, pinned = true, origin = 'human'
    WHERE src = ${seed.openWiki} AND dst = ${seed.aiWiki}`;
  // 사람이 되돌린 선: 사람이 지운 선으로 남는다
  seed.deletedEdge = [seed.privateWiki, seed.aiWiki];
  const toDelete = await c.submit(tidy, [
    {
      op: 'edge.add',
      payload: { src: seed.deletedEdge[0], dst: seed.deletedEdge[1], kind: 'link' },
    },
  ]);
  await c.revert(toDelete.id);
  await c.revert(removable.id);

  seed.openPhoto = photo();
  seed.draftPhoto = photo();
  seed.loosePhoto = photo();
  const published = await c.post(
    '공개 글',
    `첫 줄\n\n![사진](/api/files/${sha256(seed.openPhoto)})\n\n::: center\n가운데\n:::\n`,
    'published',
    { tags: ['태그 하나', '둘'], align: 'center' },
  );
  seed.published = String(published.id);
  await c.upload(published.id, seed.openPhoto);
  await c.sql`UPDATE blog.posts SET main_wiki_id = ${seed.openWiki} WHERE id = ${seed.published}`;
  for (const wiki of [seed.aiWiki, seed.privateWiki])
    await c.sql`INSERT INTO blog.post_wiki_refs (post_id, wiki_id) VALUES (${seed.published}, ${wiki})`;

  const unlisted = await c.post('링크만 글', '주소로만', 'unlisted');
  seed.unlisted = String(unlisted.id);
  const draft = await c.post(
    '임시 글',
    `![사진](/api/files/${sha256(seed.draftPhoto)})\n![같이 씀](/api/files/${sha256(seed.openPhoto)})`,
  );
  await c.upload(draft.id, seed.draftPhoto);
  await c.upload(draft.id, seed.openPhoto);
  await c.upload(draft.id, seed.loosePhoto); // 본문이 쓰지 않는 사진
  const lowered = await c.post('공개했다 내린 글', '본문', 'published');
  ok(
    await api.request('POST', `/api/posts/${lowered.id}/status`, owner, {
      status: 'draft',
      version: lowered.version,
    }),
  );
  const trashed = await c.post('휴지통 글', '지움');
  await c.upload(trashed.id, photo());
  ok(await api.request('DELETE', `/api/posts/${trashed.id}`, owner, { version: trashed.version }));
}

const zipOf = (files: readonly ArchiveFile[]): Buffer => {
  const zip = new ZipFile();
  for (const file of files) zip.add(file.path, file.body);
  return zip.toBuffer();
};

const swap = (
  files: readonly ArchiveFile[],
  path: string,
  change: (text: string) => string,
): readonly ArchiveFile[] =>
  files.map((f) => (f.path === path ? ArchiveFile.text(f.path, change(f.asText())) : f));

const pathOf = (files: readonly ArchiveFile[], part: string): string => {
  const found = files.find((f) => f.path.endsWith('.md') && f.asText().includes(part));
  assert.ok(found, part);
  return found.path;
};

/** 앞부분 끝에 모르는 키를 더한다 */
const withUnknownKeys = (text: string): string =>
  text.replace('\n---\n\n', '\nmy_note: "손으로: 적음"\naliases:\n  - 별칭 하나\n  - 둘\n---\n\n');

function assertSameFiles(actual: readonly ArchiveFile[], wanted: readonly ArchiveFile[]): void {
  assert.deepEqual(
    actual.map((f) => f.path),
    wanted.map((f) => f.path),
  );
  const expected = new Map(wanted.map((f) => [f.path, f]));
  for (const file of actual)
    assert.equal(file.asText(), expected.get(file.path)?.asText(), file.path);
  for (const file of actual) assert.ok(file.body.equals(expected.get(file.path)?.body as Buffer));
  for (const file of actual)
    assert.equal(file.isPrivateArea(), expected.get(file.path)?.isPrivateArea(), file.path);
}

let source: Cairn;
let target: Cairn;
let exported: readonly ArchiveFile[];
let tampered: readonly ArchiveFile[];
const opened: Cairn[] = [];

const boot = async (name: string): Promise<Cairn> => {
  const cairn = await Cairn.boot(name);
  opened.push(cairn);
  return cairn;
};

before(async () => {
  source = await Cairn.boot('source');
  target = await Cairn.boot('target');
  await fill(source);
  exported = await source.files();
  const wiki = pathOf(exported, seed.aiWiki);
  const session = pathOf(exported, seed.session);
  const post = pathOf(exported, seed.published);
  tampered = [wiki, session, post].reduce(
    (all, path) => swap(all, path, withUnknownKeys),
    exported,
  );
});

after(async () => {
  for (const cairn of [source, target, ...opened]) await cairn?.close();
});

describe('복원하기 전: 실패하면 아무것도 쓰지 않는다', () => {
  const refuses = async (files: readonly ArchiveFile[], message: RegExp): Promise<void> => {
    await assert.rejects(target.restores.preview(system, files), message);
    await assert.rejects(target.restore(files), message);
    assert.equal(await target.rows(), 0);
  };

  test('미리 보기는 개수만 보여 주고 아무것도 쓰지 않는다', async () => {
    const report = await target.restores.preview(system, exported);
    assert.deepEqual(
      [...report.counts],
      [
        ['카테고리', 2],
        ['wiki', 4],
        ['세션', 5],
        ['선', 3],
        ['글', 4],
        ['사진', 3],
      ],
    );
    assert.match(report.summary, /세션 5개 · 선 3개 · 글 4개 · 사진 3개/);
    assert.equal(await target.rows(), 0);
    const [row] = await target.sql`SELECT count(*)::int AS n FROM platform.blobs`;
    assert.equal(row?.n, 0);
  });

  test('cairn.json이 없거나 형식이 틀리면 멈춘다', async () => {
    await refuses(
      exported.filter((f) => f.path !== 'cairn.json'),
      /cairn\.json이 없어요/,
    );
    await refuses(
      swap(exported, 'cairn.json', () => '깨진 내용'),
      /cairn\.json을 읽을 수 없어요/,
    );
    await refuses(
      swap(exported, 'cairn.json', () => '{"format":"하나"}'),
      /format이 틀렸어요/,
    );
  });

  test('더 새로운 형식은 멈춘다', async () => {
    await refuses(
      swap(exported, 'cairn.json', () => '{"format":2,"generator":"cairn"}'),
      /더 새로운 형식이에요 \(형식 2, 이 Cairn은 1까지\)/,
    );
    await refuses(
      swap(exported, pathOf(exported, seed.aiWiki), (t) =>
        t.replace('cairn_format: 1', 'cairn_format: 2'),
      ),
      /더 새로운 형식이에요 \(2\)/,
    );
  });

  test('깨진 내용은 어느 파일인지 알려 주고 멈춘다', async () => {
    const wiki = pathOf(exported, seed.aiWiki);
    await refuses(
      swap(exported, wiki, (t) => t.replace(/^---\n/, '')),
      /앞부분\(---\)이 없어요/,
    );
    await refuses(
      swap(exported, wiki, (t) => t.replace('visibility: private', 'visibility: 이상함')),
      /visibility은\(는\) private · public 중 하나/,
    );
    await refuses(
      swap(exported, 'vault/graph.json', () => '{"edges":'),
      /graph\.json: JSON으로 읽을 수 없어요/,
    );
    await refuses(
      swap(exported, pathOf(exported, seed.session), (t) => t.replace(/## 한 일[\s\S]*/, '')),
      /한 일 · 결정/,
    );
    await refuses(
      swap(exported, pathOf(exported, seed.aiWiki), (t) =>
        t.replace('cairn_type: wiki', 'cairn_type: post'),
      ),
      /종류가 wiki이어야/,
    );
    await refuses(
      [...exported, ArchiveFile.text('vault/모르는.txt', '?')],
      /모르는 파일이에요: vault\/모르는\.txt/,
    );
    await refuses(
      [...exported, ArchiveFile.text('blog/_meta/모르는.yml', '?')],
      /모르는 파일이에요: blog/,
    );
    await refuses(
      [...exported, ArchiveFile.bytes(pathOf(exported, seed.aiWiki), Buffer.from('둘'))],
      /같은 경로가 두 번/,
    );
    await refuses(
      [...swap(exported, 'vault/categories.yml', () => '[]\n')],
      /없는 카테고리를 가리켜요/,
    );
  });

  test('사진 내용이 이름의 해시와 다르면 멈추고, 사진이 아닌 파일은 들어오지 못한다', async () => {
    const path = `assets/${sha256(seed.openPhoto)}.png`;
    await refuses(
      exported.map((f) => (f.path === path ? ArchiveFile.bytes(path, photo()) : f)),
      /내용이 파일 이름의 해시와 달라요/,
    );
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await refuses(
      [...exported, ArchiveFile.bytes(`assets/${sha256(svg)}.png`, svg)],
      /확장자와 다른 형식의 파일/,
    );
    await refuses(
      [...exported, ArchiveFile.bytes('assets/이름.png', PNG)],
      /모르는 파일이에요: assets/,
    );
  });

  test('들여올 내용이 없으면 멈춘다', async () => {
    await refuses(
      exported.filter((f) => f.path === 'cairn.json'),
      /들여올 내용이 없어요/,
    );
  });

  test('쓰다가 실패하면 트랜잭션이 되돌아가 비어 있는 채로 남는다', async () => {
    const graph = swap(exported, 'vault/graph.json', (t) =>
      t.replace('"kind": "link"', '"kind": "없는 종류"'),
    );
    await target.restores.preview(system, graph);
    await assert.rejects(target.restore(graph));
    assert.equal(await target.rows(), 0);
  });

  test('주인과 서버 자신만 복원한다', async () => {
    await assert.rejects(target.restores.preview(new VisitorActor(), exported), /주인만/);
    await assert.rejects(target.restores.apply(system, null, exported), /설치를 마친 뒤에/);
    await assert.rejects(target.restores.apply(system, 'local', exported), /설치를 마친 뒤에/);
    assert.equal(await target.rows(), 0);
  });
});

describe('왕복: 내보내기 → 빈 Cairn에 복원 → 다시 내보내기', () => {
  let report: ArchiveReport;
  let again: readonly ArchiveFile[];
  let tidy: string;

  before(async () => {
    report = await target.restore(ArchiveFile.unzip(zipOf(tampered)));
    again = await target.files();
    tidy = await target.tidyDevice('target-tidy');
  });

  test('파일 목록과 내용이 바이트까지 같다 (모르는 앞부분 키 포함)', () => {
    assertSameFiles(again, tampered);
    assert.ok(zipOf(again).equals(zipOf(tampered)), 'zip도 같다');
  });

  test('휴지통에 간 것과 그 끝점의 선은 처음부터 파일에 없다', () => {
    const graph = JSON.parse(
      exported.find((f) => f.path === 'vault/graph.json')?.asText() ?? '{}',
    ) as { edges: Json[] };
    assert.equal(graph.edges.length, 3);
    assert.equal(exported.filter((f) => f.path.startsWith('assets/')).length, 3);
    const dangling = exported.find((f) => f.asText().includes('지운 wiki의 세션'))?.asText();
    assert.ok(dangling);
    assert.equal(dangling.includes('cairn_wiki'), false);
  });

  test('결과를 알린다', () => {
    assert.equal(report.counts.get('세션'), 5);
    assert.deepEqual(report.notes, []);
  });

  test('id·종류가 그대로이고 판은 첫 판 하나다', async () => {
    for (const [table, id] of [
      ['session', seed.session],
      ['wiki', seed.openWiki],
    ]) {
      const [row] = await target.sql`SELECT kind FROM vault.nodes WHERE id = ${id ?? ''}`;
      assert.equal(row?.kind, table);
    }
    const heads = await target.sql`
      SELECT s.revision_count, s.head_revision_id, r.id, r.seq, r.kind, r.parent_ids, r.actor_type,
             s.version, s.tidy_requested_seq
      FROM vault.sessions s JOIN vault.session_revisions r ON r.session_id = s.node_id`;
    assert.equal(heads.length, 5);
    for (const h of heads) {
      assert.equal(h.head_revision_id, h.id);
      assert.deepEqual(
        [h.revision_count, h.seq, h.kind, h.actor_type, h.version],
        [1, 1, 'origin', 'system', 1],
      );
      assert.deepEqual(h.parent_ids, []);
    }
    const wikis = await target.sql`
      SELECT w.revision_count, w.head_revision_id, r.id, r.seq, r.change_set_id
      FROM vault.wikis w JOIN vault.wiki_revisions r ON r.wiki_id = w.node_id`;
    assert.equal(wikis.length, 4);
    for (const w of wikis) assert.deepEqual([w.revision_count, w.seq], [1, 1]);
    for (const w of wikis) assert.equal(w.head_revision_id, w.id);
    const posts = await target.sql`
      SELECT p.head_revision_id, r.id, r.seq FROM blog.posts p JOIN blog.post_revisions r ON r.post_id = p.id`;
    assert.equal(posts.length, 4);
    for (const p of posts) assert.deepEqual([p.seq, p.head_revision_id], [1, p.id]);
  });

  test('칸·해시·찾기용 글이 원본의 지금 판과 같다', async () => {
    const wikis = (c: Cairn) => c.sql`
      SELECT w.node_id, w.head_text, r.sections, r.section_hashes, r.content_hash
      FROM vault.wikis w JOIN vault.wiki_revisions r ON r.id = w.head_revision_id
      JOIN vault.nodes n ON n.id = w.node_id WHERE n.deleted_at IS NULL ORDER BY w.node_id`;
    assert.deepEqual([...(await wikis(target))], [...(await wikis(source))]);

    const sessions = (c: Cairn) => c.sql`
      SELECT s.node_id, s.head_title, s.head_text, r.sections, r.section_hashes, r.content_hash, r.body_md
      FROM vault.sessions s JOIN vault.session_revisions r ON r.id = s.head_revision_id
      WHERE s.node_id <> ${seed.tricky} ORDER BY s.node_id`;
    assert.deepEqual([...(await sessions(target))], [...(await sessions(source))]);

    const posts = (c: Cairn) => c.sql`
      SELECT id, slug, status, title, excerpt, head_text, tags, align, main_wiki_id, published_at
      FROM blog.posts WHERE deleted_at IS NULL ORDER BY id`;
    assert.deepEqual([...(await posts(target))], [...(await posts(source))]);
  });

  test('칸 소제목이 글에 든 세션도 본문은 그대로다', async () => {
    const [row] = await target.sql`
      SELECT r.body_md, r.sections FROM vault.session_revisions r WHERE r.session_id = ${seed.tricky}`;
    assert.ok(String(row?.body_md).includes('## 결정\n\n본문 안의 소제목'));
    assert.equal((row?.sections as Json | undefined)?.extra, '기타 칸');
  });

  test('공개 범위와 사람이 고친 표시가 돌아온다', async () => {
    const pins = (c: Cairn) => c.sql`
      SELECT node_id, visibility, origin, pinned_sections FROM vault.wikis ORDER BY node_id`;
    const live = (await pins(source)).filter((r) =>
      [seed.openWiki, seed.privateWiki, seed.aiWiki].includes(String(r.node_id)),
    );
    const restored = (await pins(target)).filter((r) =>
      [seed.openWiki, seed.privateWiki, seed.aiWiki].includes(String(r.node_id)),
    );
    assert.deepEqual([...restored], [...live]);
    const [session] = await target.sql`
      SELECT pinned_sections, wiki_id FROM vault.sessions WHERE node_id = ${seed.session}`;
    assert.deepEqual(session?.pinned_sections, ['#wiki']);
    assert.equal(session?.wiki_id, seed.openWiki);
    const categories = (c: Cairn) => c.sql`
      SELECT node_id, name, slug, color, description, sort, origin, pinned FROM vault.categories ORDER BY node_id`;
    assert.deepEqual([...(await categories(target))], [...(await categories(source))]);
  });

  test('선의 출처·고정·지운 흔적이 돌아온다', async () => {
    const edges = (c: Cairn) => c.sql`
      SELECT e.id, e.src, e.dst, e.kind, e.weight, e.origin, e.pinned, e.deleted_at, e.deleted_by_type
      FROM vault.edges e
      JOIN vault.nodes a ON a.id = e.src AND a.deleted_at IS NULL
      JOIN vault.nodes b ON b.id = e.dst AND b.deleted_at IS NULL
      ORDER BY e.id`;
    const restored = [...(await edges(target))];
    assert.deepEqual(restored, [...(await edges(source))]);
    assert.ok(restored.some((e) => e.weight === 0.37 && e.pinned === true && e.origin === 'human'));
    assert.ok(restored.some((e) => e.deleted_by_type === 'user' && e.deleted_at !== null));
  });

  test('글 자리 사본이 바로 맞고, 이벤트는 하나도 남지 않는다', async () => {
    const [mark] =
      await target.sql`SELECT * FROM vault.post_marks WHERE post_id = ${seed.published}`;
    assert.equal(mark?.title, '공개 글');
    assert.equal(mark?.status, 'published');
    assert.equal(mark?.main_wiki_id, seed.openWiki);
    assert.deepEqual(
      [...((mark?.ref_wiki_ids ?? []) as string[])].sort(),
      [seed.aiWiki, seed.privateWiki].sort(),
    );
    assert.equal(mark?.post_version, 1);
    const [link] =
      await target.sql`SELECT status FROM vault.post_marks WHERE post_id = ${seed.unlisted}`;
    assert.equal(link?.status, 'draft', '링크만 공개는 그래프에서 임시와 같다');
    const [events] = await target.sql`
      SELECT count(*)::int AS n FROM platform.outbox
      WHERE topic LIKE 'vault.%' OR topic LIKE 'blog.%' OR topic LIKE 'task.%'`;
    assert.equal(events?.n, 0);
    const res = await target.api.get('/api/graph/public');
    assert.ok(res.text.includes('공개 글'), '방문자 그래프에 글이 나온다');
  });

  test('방문자는 공개된 글·wiki·사진만 본다', async () => {
    const { api } = target;
    assert.equal((await api.get(`/api/files/${sha256(seed.openPhoto)}`)).status, 200);
    assert.equal((await api.get(`/api/files/${sha256(seed.draftPhoto)}`)).status, 404);
    assert.equal((await api.get(`/api/wikis/${seed.privateWiki}`)).status, 404);
    assert.equal((await api.get(`/api/wikis/${seed.openWiki}`)).status, 200);
    const list = await api.get('/api/posts');
    assert.ok(list.text.includes('공개 글'));
    assert.equal(list.text.includes('임시 글'), false);
    assert.equal(list.text.includes('링크만 글'), false);
    const [file] =
      await target.sql`SELECT mime FROM platform.blobs WHERE hash = ${sha256(seed.openPhoto)}`;
    assert.equal(file?.mime, 'image/png');
  });

  test('비어 있지 않으면 거절한다 (미리 보기도)', async () => {
    const before = await target.rows();
    await assert.rejects(
      target.restores.preview(system, exported),
      /빈 Cairn에만 복원할 수 있어요. 지금 카테고리 2개 · wiki 4개 · 세션 5개 · 글 4개가 있어요/,
    );
    await assert.rejects(target.restore(exported), /빈 Cairn에만/);
    assert.equal(await target.rows(), before);
  });

  test('다시 연결한 기기가 새 세션을 저장한다: 복원한 세션과 대화 id가 같아도 섞이지 않는다', async () => {
    const device = await target.api.connectDevice(target.owner, 'after-restore');
    const saved = await target.tool(device, 'save_session', {
      request_id: randomUUID(),
      source_session_id: seed.session,
      tool: 'claude-code',
      title: '복원 뒤 첫 세션',
      did: '다시 연결했다',
    });
    assert.equal(saved.status, 'saved');
    assert.notEqual(saved.session_id, seed.session);
    const again2 = await target.tool(device, 'save_session', {
      request_id: randomUUID(),
      source_session_id: seed.session,
      tool: 'claude-code',
      title: '복원 뒤 첫 세션',
      did: '다시 연결했고 더 했다',
    });
    assert.equal(again2.session_id, saved.session_id, '같은 대화는 판이 쌓인다');
    const [added] = await target.sql`
      SELECT revision_count FROM vault.sessions WHERE node_id = ${String(saved.session_id)}`;
    assert.equal(added?.revision_count, 2);
    const [row] =
      await target.sql`SELECT revision_count FROM vault.sessions WHERE node_id = ${seed.session}`;
    assert.equal(row?.revision_count, 1, '복원한 세션은 그대로다');
  });

  test('AI는 사람이 지운 선을 다시 만들지 못한다', async () => {
    const [src, dst] = seed.deletedEdge;
    const set = await target.submit(tidy, [
      { op: 'edge.add', payload: { src, dst, kind: 'link' } },
    ]);
    assert.equal(set.ops[0]?.status, 'rejected');
    assert.match(String(set.ops[0]?.reason), /사람이 지운/);
  });

  test('복원한 뒤에 고칠 수 있다: 새 판이 쌓이고 사람이 고친 칸은 AI가 덮지 못한다', async () => {
    const { api, owner } = target;
    const wiki = ok(await api.get(`/api/wikis/${seed.openWiki}`, owner));
    ok(
      await api.request('PUT', `/api/wikis/${seed.openWiki}`, owner, {
        title: wiki.title,
        bodyMd: `${wiki.bodyMd}\n\n더 씀`,
        version: wiki.version,
      }),
    );
    const [count] = await target.sql`
      SELECT count(*)::int AS n FROM vault.wiki_revisions WHERE wiki_id = ${seed.openWiki}`;
    assert.equal(count?.n, 2);

    const revised = await target.submit(tidy, [
      {
        op: 'wiki.revise',
        target_id: seed.openWiki,
        base_version: 2,
        payload: { title: wiki.title, body_md: 'AI가 통째로 덮음' },
      },
    ]);
    assert.equal(revised.ops[0]?.status, 'waiting', '검토로 간다');

    const post = ok(
      await api.request('PUT', `/api/posts/${seed.published}`, owner, {
        title: '공개 글',
        body: '고쳐 쓴 본문',
        tags: ['태그 하나'],
        align: 'center',
        version: 1,
      }),
    );
    assert.equal(post.version, 2);
    const [revisions] = await target.sql`
      SELECT max(seq)::int AS seq FROM blog.post_revisions WHERE post_id = ${seed.published}`;
    assert.equal(revisions?.seq, 2);
  });

  test('글 이벤트가 오면 복원한 사본의 버전을 넘어 갱신된다', async () => {
    const worker = target.api.service(OutboxWorker);
    for (let i = 0; i < 50 && (await worker.tick()) > 0; i++);
    const [mark] =
      await target.sql`SELECT post_version FROM vault.post_marks WHERE post_id = ${seed.published}`;
    assert.equal(mark?.post_version, 2);
  });
});

describe('두 복원이 겹치면', () => {
  test('하나만 들어가고 다른 하나는 비어 있지 않아 거절된다', async () => {
    const cairn = await boot('race');
    const results = await Promise.allSettled([cairn.restore(exported), cairn.restore(exported)]);
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.match(failed.reason.message, /빈 Cairn에만/);
    assertSameFiles(await cairn.files(), exported);
  });

  test('복원 중에는 내보내기가 끝나기를 기다린다: 절반만 복원된 모습을 보지 않는다', async () => {
    const cairn = await boot('steady');
    let release = (): void => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => {};
    const taken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const restoring = cairn.api.service(Database).transaction(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('platform.archive.restore', 0))`;
      locked();
      await hold;
    });
    await taken;
    let read = false;
    const reading = cairn.restores.steadyRead(async () => {
      read = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(read, false);
    release();
    await restoring;
    await reading;
    assert.equal(read, true);
  });
});

describe('다른 묶음', () => {
  test('옛 백업: 사람이 고친 표시가 없으면 사람의 것으로 두고, 사진 행은 본문에서 찾는다', async () => {
    const cairn = await boot('old');
    const strip = (text: string): string =>
      text
        .replace(/^(cairn_origin|cairn_pinned|cairn_assets): .*\n/gm, '')
        .replace(/^ {2}(origin|pinned): .*\n/gm, '');
    const old = exported.map((f) =>
      f.path.endsWith('.md') || f.path.endsWith('.yml')
        ? ArchiveFile.text(f.path, strip(f.asText()))
        : f,
    );
    const report = await cairn.restore(old);
    assert.ok(
      report.notes.some((n) => /어느 글에도 붙지 않은 사진 1개/.test(n)),
      report.notes.join(),
    );
    const [wiki] = await cairn.sql`
      SELECT origin, pinned_sections FROM vault.wikis WHERE node_id = ${seed.aiWiki}`;
    assert.equal(wiki?.origin, 'human');
    assert.deepEqual(wiki?.pinned_sections, ['#title', '칸']);
    const [session] = await cairn.sql`
      SELECT pinned_sections FROM vault.sessions WHERE node_id = ${seed.session}`;
    assert.deepEqual(session?.pinned_sections, ['#wiki']);
    const [category] = await cairn.sql`SELECT origin, pinned FROM vault.categories LIMIT 1`;
    assert.deepEqual([category?.origin, category?.pinned], ['human', true]);
    const assets =
      await cairn.sql`SELECT blob_hash FROM blog.assets WHERE post_id = ${seed.published}`;
    assert.deepEqual(
      assets.map((a) => a.blob_hash),
      [sha256(seed.openPhoto)],
    );
  });

  test('공개 저장소의 묶음: 글과 사진만 들어오고 글 → wiki 연결 값은 남는다', async () => {
    const cairn = await boot('public');
    const open = exported.filter((f) => !f.isPrivateArea());
    const report = await cairn.restore(open);
    assert.ok(report.notes.some((n) => /vault 파일이 없어요/.test(n)));
    assert.equal(report.counts.get('세션'), undefined);
    assert.equal(report.counts.get('글'), 1);
    const [post] =
      await cairn.sql`SELECT main_wiki_id FROM blog.posts WHERE id = ${seed.published}`;
    assert.equal(post?.main_wiki_id, seed.openWiki);
    const [mark] =
      await cairn.sql`SELECT main_wiki_id FROM vault.post_marks WHERE post_id = ${seed.published}`;
    assert.equal(mark?.main_wiki_id, null, 'wiki가 없으니 그래프에는 나오지 않는다');
    const after = await cairn.files();
    const wanted = new Map(open.map((f) => [f.path, f.asText()]));
    for (const file of after.filter((f) => !f.isPrivateArea() && f.path.startsWith('blog/')))
      assert.equal(file.asText(), wanted.get(file.path));
  });

  test('없는 것을 가리키는 값은 빼고 알려 주고, 고정한 점 위치는 보기가 있을 때만 돌아온다', async () => {
    const cairn = await boot('dangling');
    await cairn.sql`
      INSERT INTO vault.graph_views (space_id, name, audience)
      VALUES (${await cairn.spaceId}, '내 보기', 'owner')`;
    const missing = randomUUID();
    const graph = swap(exported, 'vault/graph.json', (t) => {
      const parsed = JSON.parse(t) as { edges: Json[]; pinned_nodes: Json[] };
      parsed.edges.push({ ...parsed.edges[0], cairn_id: randomUUID(), src: missing });
      parsed.pinned_nodes = [
        { view: '내 보기', node: seed.aiWiki, x: 1.5, y: -2 },
        { view: '없는 보기', node: seed.aiWiki, x: 3, y: 4 },
      ];
      return JSON.stringify(parsed);
    });
    const files = swap(graph, pathOf(graph, seed.session), (t) =>
      t.replace(seed.openWiki, missing),
    ).filter((f) => f.path !== `assets/${sha256(seed.draftPhoto)}.png`);
    const report = await cairn.restore(files);
    assert.ok(
      report.notes.some((n) => /묶음에 없는 사진 1개/.test(n)),
      report.notes.join(),
    );
    assert.ok(
      report.notes.some((n) => /고정한 점 위치 1개/.test(n)),
      report.notes.join(),
    );
    const placed = JSON.parse(
      (await cairn.files()).find((f) => f.path === 'vault/graph.json')?.asText() ?? '{}',
    ) as { pinned_nodes: Json[] };
    assert.deepEqual(placed.pinned_nodes, [{ view: '내 보기', node: seed.aiWiki, x: 1.5, y: -2 }]);
    assert.ok(
      report.notes.some((n) => /끝점이 없는 선 1개/.test(n)),
      report.notes.join(),
    );
    assert.ok(
      report.notes.some((n) => /세션 1개는 도착 구역/.test(n)),
      report.notes.join(),
    );
    const [session] =
      await cairn.sql`SELECT wiki_id FROM vault.sessions WHERE node_id = ${seed.session}`;
    assert.equal(session?.wiki_id, null);
  });
});

describe('cairn-admin restore (표준 입력의 zip)', () => {
  const admin = (cairn: Cairn, args: readonly string[], input: Buffer) =>
    spawnSync('node', ['-r', '@swc-node/register', 'src/main.cli.ts', 'restore', ...args], {
      input,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: { ...process.env, DATABASE_URL: cairn.database.url, CAIRN_BLOBS_DIR: cairn.blobs },
    });

  test('기본은 미리 보기, --apply로 들여오고, 깨진 zip은 짧게 알린다', async () => {
    const cairn = await boot('cli');
    const zip = zipOf(exported);
    const preview = admin(cairn, [], zip);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /들어올 내용: .*세션 5개 · 선 3개 · 글 4개 · 사진 3개/);
    assert.match(preview.stdout, /--apply/);
    assert.equal(await cairn.rows(), 0);

    const broken = admin(cairn, ['--apply'], Buffer.from('zip이 아님'));
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /zip 파일이 아니에요/);
    assert.equal(await cairn.rows(), 0);

    const unknown = admin(cairn, ['--force'], zip);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /모르는 옵션/);

    const applied = admin(cairn, ['--apply'], zip);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /✔ 복원했어요: /);
    assert.match(applied.stdout, /기기는 다시 연결해 주세요/);
    assertSameFiles(await cairn.files(), exported);

    const twice = admin(cairn, ['--apply'], zip);
    assert.equal(twice.status, 1);
    assert.match(twice.stderr, /빈 Cairn에만/);
  });
});

/** 플러그인의 가짜 GitHub. 서버 코드는 src 밖을 가져오지 못해 실행 중에 불러온다 (플러그인 등록과 같은 길) */
interface FakeGithub {
  isPrivate: boolean;
  start(): Promise<string>;
  stop(): Promise<void>;
  filesAt(branch: string): Map<string, string>;
}

describe('sync-github: 저장소에서 복원', () => {
  let fake: FakeGithub;
  let apiUrl: string;

  const connect = async (cairn: Cairn): Promise<void> => {
    const { api, owner } = cairn;
    ok(await api.request('POST', '/api/plugins/sync-github/enable', owner));
    ok(
      await api.request('PUT', '/api/plugins/sync-github/settings', owner, {
        values: { repo: 'me/backup', token: 't0ken', branch: 'main', apiUrl },
      }),
    );
  };
  const run = (cairn: Cairn, action: string) =>
    cairn.api.request('POST', `/api/plugins/sync-github/actions/${action}`, cairn.owner);

  before(async () => {
    const entry = resolve(process.cwd(), '../../plugins/sync-github/server/fake-github');
    const loaded = require(entry) as { FakeGithub: new () => FakeGithub };
    fake = new loaded.FakeGithub();
    apiUrl = await fake.start();
    await connect(source);
    const pushed = ok(await run(source, 'sync-now'));
    assert.equal(pushed.ok, true, String(pushed.message));
  });
  after(() => fake.stop());

  test('빈 Cairn의 동기화는 백업을 지우지 않고 복원을 가리킨다', async () => {
    const cairn = await boot('plugin');
    await connect(cairn);
    const backup = fake.filesAt('main');
    const refused = ok(await run(cairn, 'sync-now'));
    assert.equal(refused.ok, false);
    assert.match(String(refused.message), /비어 있는 Cairn이라 동기화를 멈췄어요/);
    assert.match(String(refused.details), /restore-preview/);
    assert.deepEqual(fake.filesAt('main'), backup);

    const preview = ok(await run(cairn, 'restore-preview'));
    assert.equal(preview.ok, true, preview.message as string);
    assert.match(String(preview.message), /세션 5개 · 선 3개 · 글 4개 · 사진 3개/);
    assert.equal(await cairn.rows(), 0);

    const restored = ok(await run(cairn, 'restore'));
    assert.equal(restored.ok, true, restored.message as string);
    assert.match(String(restored.details), /기기는 다시 연결/);
    assertSameFiles(await cairn.files(), exported);

    const synced = ok(await run(cairn, 'sync-now'));
    assert.equal(synced.message, '바뀐 것이 없어요');
    assert.deepEqual(fake.filesAt('main'), backup);

    const twice = await run(cairn, 'restore');
    assert.equal(twice.status, 422);
    assert.match(twice.text, /빈 Cairn에만/);
    const visitor = await cairn.api.request('POST', '/api/plugins/sync-github/actions/restore');
    assert.equal(visitor.status, 403);
  });

  test('write 권한을 가진 기기도 복원하지 못한다 (주인만)', async () => {
    const cairn = await boot('writer');
    await connect(cairn);
    const writer = await cairn.device('writer', ['write']);
    for (const action of ['restore-preview', 'restore']) {
      const res = await fetch(`${cairn.api.baseUrl}/api/plugins/sync-github/actions/${action}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${writer}` },
      });
      assert.equal(res.status, 403, await res.text());
    }
    assert.equal(await cairn.rows(), 0);
  });
});
