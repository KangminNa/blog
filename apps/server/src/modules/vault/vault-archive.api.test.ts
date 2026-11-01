import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { ApiClient, type ApiResult, TestUser } from '../../testing/api-client';
import { ArchiveFile, ArchiveQuery, SystemActor } from '../platform';

// 보관 형식 내보내기 (docs/보관형식.md). zip을 실제로 열어 경로와 내용을 보고, 비밀값이 없는지 확인한다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let device: string;
let tidy: string;
let files: Map<string, string>;
let session: string;
let wiki: Json;
let category: Json;
let post: Json;
const ownerPassword = ApiClient.OWNER_PASSWORD;
const leaked = `gh${'p_'}${'Z9y8X7w6'.repeat(5)}`;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** zip의 파일들을 읽는다 (지역 머리글을 차례로) */
function unzip(zip: Buffer): Map<string, string> {
  const found = new Map<string, string>();
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extra = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extra;
    found.set(name, inflateRawSync(zip.subarray(start, start + size)).toString('utf8'));
    at = start + size;
  }
  return found;
}

function download(as?: TestUser): Promise<Response> {
  return fetch(`${api.baseUrl}/api/archive.zip`, { headers: as ? { cookie: as.header } : {} });
}

async function tool(token: string, name: string, args: Json): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.notEqual(result.isError, true, res.text);
  return result.structuredContent ?? {};
}

const fileWith = (id: unknown): string =>
  [...files.entries()].find(
    ([path, text]) => path.endsWith('.md') && text.includes(String(id)),
  )?.[0] ?? '';

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const space = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version: space.version,
  });
  device = await api.connectDevice(owner, 'archive-laptop');
  tidy = await api.connectDevice(owner, 'archive-tidy');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; version: number }[];
  };
  const target = devices.find((d) => d.name === 'archive-tidy');
  ok(
    await api.request('PATCH', `/api/devices/${target?.id}`, owner, {
      scopes: ['tidy', 'read_all'],
      version: target?.version,
    }),
  );

  category = ok(
    await api.request('POST', '/api/categories', owner, {
      requestId: randomUUID(),
      name: `보관: 구역 ${randomUUID()}`,
      color: '#000000',
      description: '여러 줄\n기준',
    }),
    201,
  );
  wiki = ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: `보관 "wiki" ${randomUUID()}`,
      bodyMd: '## 배경\n\n[[다른 wiki]]와 잇는다',
      categoryId: category.id,
    }),
    201,
  );
  const saved = await tool(device, 'save_session', {
    request_id: randomUUID(),
    source_session_id: `conv-${randomUUID()}`,
    tool: 'claude-code',
    project: '../위험한/프로젝트',
    title: '보관 형식 만들기',
    tags: ['백업', '보관'],
    did: `토큰 ${leaked} 를 썼다`,
    started_at: '2026-10-31T09:40:00.000Z',
  });
  session = String(saved.session_id);
  await tool(tidy, 'submit_changes', {
    request_id: randomUUID(),
    message: '대표와 선',
    ops: [
      { op: 'session.assign', target_id: session, payload: { wiki_id: wiki.id } },
      { op: 'wiki.create', payload: { title: `이웃 ${randomUUID()}`, body_md: '본문' } },
      { op: 'edge.add', payload: { src: wiki.id, dst: '@2', kind: 'link' } },
    ],
  });
  post = ok(
    await api.request('POST', '/api/posts', owner, {
      requestId: randomUUID(),
      title: `보관 글 ${randomUUID()}`,
      body: '글 본문',
    }),
    201,
  );
  const res = await download(owner);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition') ?? '', /cairn-archive\.zip/);
  files = unzip(Buffer.from(await res.arrayBuffer()));
});
after(() => api.close());

describe('보관 형식 내보내기', () => {
  test('주인만 받는다', async () => {
    assert.equal((await download()).status, 403);
    const res = await api.get('/api/archive.zip', TestUser.visitor);
    assert.equal(res.status, 403);
  });

  test('cairn.json이 맨 위에 있다', () => {
    assert.equal([...files.keys()][0], 'cairn.json');
    const head = JSON.parse(files.get('cairn.json') ?? '{}');
    assert.deepEqual([head.format, head.generator], [1, 'cairn']);
  });

  test('경로는 모두 보관 형식 안에 있다', () => {
    for (const path of files.keys())
      assert.match(
        path,
        /^(cairn\.json|vault\/categories\.yml|vault\/graph\.json|vault\/wikis\/[^/]+\.md|vault\/sessions\/[^/]+\/\d{4}-\d{2}-\d{2}-[^/]+\.md|blog\/posts\/\d{4}\/[^/]+\.md)$/,
        path,
      );
    assert.ok(files.has('vault/categories.yml'));
    assert.ok(files.has('vault/graph.json'));
  });

  test('wiki: 앞부분과 본문', () => {
    const text = files.get(`vault/wikis/${wiki.slug}.md`) ?? '';
    assert.match(text, /^---\ncairn_format: 1\ncairn_type: wiki\n/);
    assert.match(text, new RegExp(`cairn_id: "?${wiki.id}"?\\n`));
    assert.match(text, /visibility: private\n/);
    assert.match(text, new RegExp(`cairn_category: "?${category.id}"?\\n`));
    // 따옴표가 든 제목은 YAML 문자열로
    assert.ok(text.includes(`title: ${JSON.stringify(wiki.title)}\n`));
    assert.ok(text.endsWith('---\n\n## 배경\n\n[[다른 wiki]]와 잇는다'));
  });

  test('세션: 프로젝트·날짜·제목으로 된 경로, 프로젝트 이름으로 폴더를 벗어나지 않는다', () => {
    const path = fileWith(session);
    assert.equal(path, 'vault/sessions/위험한-프로젝트/2026-10-31-보관-형식-만들기.md');
    const text = files.get(path) ?? '';
    assert.match(text, /cairn_type: session\n/);
    assert.match(text, /tool: claude-code\n/);
    assert.match(text, /visibility: private\n/);
    assert.match(text, new RegExp(`cairn_wiki: "?${wiki.id}"?\\n`));
    assert.match(text, /tags: \[백업, 보관\]\n/);
    assert.match(text, /## 한 일\n/);
  });

  test('글: 연도 폴더와 앞부분', () => {
    const path = fileWith(post.id);
    assert.match(path, new RegExp(`^blog/posts/\\d{4}/${post.slug}\\.md$`));
    const text = files.get(path) ?? '';
    assert.match(text, /cairn_type: post\n/);
    assert.match(text, /status: draft\n/);
    assert.match(text, /published: null\n/);
    assert.ok(text.endsWith('글 본문'));
  });

  test('카테고리 yml', () => {
    const text = files.get('vault/categories.yml') ?? '';
    assert.ok(
      text.includes(`- cairn_id: ${JSON.stringify(category.id).slice(1, -1)}`) ||
        text.includes(`- cairn_id: ${JSON.stringify(category.id)}`),
    );
    assert.ok(text.includes(`  name: ${JSON.stringify(category.name)}\n`));
    assert.ok(text.includes('  description: "여러 줄\\n기준"\n'));
  });

  test('그래프: 선과 출처', () => {
    const graph = JSON.parse(files.get('vault/graph.json') ?? '{}') as { edges: Json[] };
    const edge = graph.edges.find((e) => e.src === wiki.id || e.dst === wiki.id);
    assert.deepEqual([edge?.kind, edge?.origin, edge?.pinned], ['link', 'ai', false]);
  });

  test('비밀값이 어디에도 없다', () => {
    const all = [...files.values()].join('\n');
    for (const secret of [
      leaked,
      device,
      tidy,
      ownerPassword,
      process.env.CAIRN_SECRET_KEY ?? 'nothing',
      'scrypt$',
      'token_hash',
      'password_hash',
    ])
      assert.equal(all.includes(secret), false, secret.slice(0, 8));
    assert.equal(all.includes('[지움: GitHub 토큰]'), true);
  });

  test('동기화 플러그인의 길(공간 없는 SystemActor)로도 같은 파일이 나온다', async () => {
    const synced = await api.service(ArchiveQuery).files(new SystemActor());
    assert.ok(synced.every((f) => f instanceof ArchiveFile));
    assert.deepEqual(synced.map((f) => f.path).sort(), [...files.keys()].sort());
    const vault = synced.filter((f) => f.isPrivateArea());
    assert.ok(vault.length > 0);
    assert.ok(synced.some((f) => !f.isPrivateArea()));
  });

  test('휴지통에 간 것은 빠진다', async () => {
    const gone = ok(
      await api.request('POST', '/api/categories', owner, {
        requestId: randomUUID(),
        name: `지울 구역 ${randomUUID()}`,
      }),
      201,
    );
    ok(await api.request('DELETE', `/api/categories/${gone.id}`, owner, { version: 1 }));
    const res = await download(owner);
    const text = unzip(Buffer.from(await res.arrayBuffer())).get('vault/categories.yml') ?? '';
    assert.equal(text.includes(String(gone.id)), false);
  });
});

describe('ArchiveFile', () => {
  test('따옴표 없이 쓸 수 없는 값은 JSON 문자열로 적는다', () => {
    const file = ArchiveFile.markdown(
      'vault/wikis/a.md',
      {
        plain: '평범한 제목',
        colon: 'a: b',
        number: '123',
        yes: 'yes',
        list: ['a,b', '다'],
        none: null,
      },
      '본문',
    );
    assert.equal(
      file.asText(),
      '---\nplain: 평범한 제목\ncolon: "a: b"\nnumber: "123"\nyes: "yes"\nlist: ["a,b", 다]\nnone: null\n---\n\n본문',
    );
  });

  test('빈 목록은 []', () => {
    assert.equal(ArchiveFile.yamlList('vault/categories.yml', []).asText(), '[]\n');
  });

  test('보관 형식 밖의 경로는 만들지 않는다', () => {
    assert.throws(() => ArchiveFile.text('vault/../etc/passwd', 'x'));
    assert.throws(() => ArchiveFile.text('etc/passwd', 'x'));
  });
});
