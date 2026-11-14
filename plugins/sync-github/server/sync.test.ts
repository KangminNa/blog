import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  ArchiveFile,
  type ArchiveRestoreService,
  OwnerActor,
  VisitorActor,
} from '../../../apps/server/src/plugin-api';
import { CheckAction } from './check.action';
import { FakeGithub } from './fake-github';
import { GithubGateway } from './github.gateway';
import { RestoreAction } from './restore.action';
import { RestorePreviewAction } from './restore-preview.action';
import { SyncJob } from './sync.job';

// 가짜 GitHub로 동기화의 약속을 확인한다: 바뀐 것만 커밋, 없어진 파일은 지움, 다른 파일은 안 건드림,
// 공개 저장소에는 비공개 파일을 보내지 않음, private 저장소에는 사진까지 전부, 받아 온 파일이 보낸 파일과 같음.

let fake: FakeGithub;
let api: string;
let archive: ArchiveFile[];

const cairnJson = ArchiveFile.text('cairn.json', '{"format":1}\n');
const session = ArchiveFile.text('vault/sessions/api/2026-10-10-oauth.md', '## 한 일\n토큰 갱신\n');
const post = ArchiveFile.text('blog/posts/2026/mcp-login.md', '# MCP 로그인\n');
const photo = ArchiveFile.bytes(
  'assets/3fa9c1.png',
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
);

function job(branch = 'main'): SyncJob {
  return new SyncJob(
    new GithubGateway('me/cairn-archive', 't0ken', api),
    branch,
    async () => archive,
    [],
  );
}

before(async () => {
  fake = new FakeGithub();
  api = await fake.start();
});
after(() => fake.stop());

describe('sync-github', () => {
  test('빈 저장소에 처음 보내고, 바뀐 게 없으면 커밋하지 않는다', async () => {
    archive = [cairnJson, session, post, photo];
    const first = await job().syncOnce();
    assert.equal(first.ok, true, first.message);
    assert.deepEqual([...fake.filesAt('main').keys()].sort(), archive.map((f) => f.path).sort());
    const commits = fake.commits.size;
    const second = await job().syncOnce();
    assert.equal(second.message, '바뀐 것이 없어요');
    assert.equal(fake.commits.size, commits);
  });

  test('없어진 보관 파일은 지우고, README처럼 보관 형식 밖의 파일은 그대로 둔다', async () => {
    fake.seed('main', 'README.md', '내 보관소');
    archive = [cairnJson, session, photo];
    const result = await job().syncOnce();
    assert.match(result.message, /0개 올림, 1개 지움/);
    const files = fake.filesAt('main');
    assert.equal(files.has(post.path), false);
    assert.equal(files.get('README.md'), '내 보관소');
  });

  test('받아 온 파일이 보낸 파일과 바이트까지 같다 (사진 포함)', async () => {
    const gh = new GithubGateway('me/cairn-archive', 't0ken', api);
    const files = [cairnJson, session, photo];
    await gh.commit('bytes', await gh.snapshot('bytes'), files, '바이트 확인');
    const downloaded = await gh.download('bytes');
    const byPath = new Map(downloaded.map((f) => [f.path, f.body]));
    for (const f of files) assert.deepEqual(byPath.get(f.path), f.body, f.path);
    assert.equal(byPath.has('README.md'), false);
  });

  test('공개 저장소에는 vault, 임시 글, 공개되지 않은 사진이 가지 않는다', async () => {
    const open = new FakeGithub();
    open.isPrivate = false;
    const url = await open.start();
    const draft = ArchiveFile.text('blog/posts/2026/draft.md', '임시 글\n').keptPrivate();
    const draftPhoto = ArchiveFile.bytes('assets/aa11.png', Buffer.from([1, 2, 3])).keptPrivate();
    archive = [cairnJson, session, post, draft, photo, draftPhoto];
    const gh = new GithubGateway('me/cairn-site', 't0ken', url);
    const result = await new SyncJob(gh, 'main', async () => archive, []).syncOnce();
    await open.stop();
    assert.equal(result.ok, true, result.message);
    const sent = [cairnJson, post, photo].map((f) => f.path).sort();
    assert.deepEqual([...open.filesAt('main').keys()].sort(), sent);
    assert.deepEqual(result.details, ['저장소가 공개라 비공개 파일 3개는 보내지 않았어요']);
  });

  test('공개 저장소에 vault가 이미 있으면 멈추고, 없으면 vault만 빼고 보낸다', async () => {
    fake.isPrivate = false;
    const blocked = await job().syncOnce();
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /공개 저장소에 vault 파일이 있어요/);

    archive = [cairnJson, session, post];
    const fresh = await job('public-site').syncOnce();
    assert.equal(fresh.ok, false, '갈라 만든 브랜치에도 main의 vault가 따라오므로 막혀야 한다');
    fake.isPrivate = true;
  });

  test('빈 Cairn은 백업이 있는 저장소를 지우지 않는다', async () => {
    const guarded = new FakeGithub();
    const url = await guarded.start();
    const gh = new GithubGateway('me/backup', 't0ken', url);
    const sync = new SyncJob(gh, 'main', async () => archive, []);
    archive = [cairnJson, session, post, photo];
    await sync.syncOnce();
    const backup = guarded.filesAt('main');

    archive = [cairnJson, ArchiveFile.text('vault/categories.yml', '[]\n')];
    const refused = await sync.syncOnce();
    assert.equal(refused.ok, false);
    assert.match(refused.message, /비어 있는 Cairn이라 동기화를 멈췄어요/);
    assert.ok(refused.details.some((d) => d.includes('restore-preview')));
    assert.deepEqual(guarded.filesAt('main'), backup);
    await assert.rejects(sync.run(), /비어 있는 Cairn/);

    const onlyNew = await new SyncJob(gh, 'other', async () => archive, []).syncOnce();
    assert.equal(onlyNew.ok, false, '새 브랜치도 기본 브랜치의 백업을 보고 멈춘다');
    await guarded.stop();
  });

  test('처음 쓰는 저장소와 내용 없는 저장소는 빈 Cairn도 맞춘다', async () => {
    const empty = new FakeGithub();
    const url = await empty.start();
    const gh = new GithubGateway('me/new', 't0ken', url);
    archive = [cairnJson, ArchiveFile.text('vault/categories.yml', '[]\n')];
    const sync = new SyncJob(gh, 'main', async () => archive, []);
    const first = await sync.syncOnce();
    assert.equal(first.ok, true, first.message);
    const second = await sync.syncOnce();
    assert.equal(second.message, '바뀐 것이 없어요');
    await empty.stop();
  });

  test('내용이 있으면 공개 저장소로 보낼 것이 없어도 빈 Cairn으로 보지 않는다', async () => {
    const open = new FakeGithub();
    open.isPrivate = false;
    const url = await open.start();
    const gh = new GithubGateway('me/site', 't0ken', url);
    archive = [cairnJson, post];
    await new SyncJob(gh, 'main', async () => archive, []).syncOnce();
    archive = [cairnJson, session];
    const result = await new SyncJob(gh, 'main', async () => archive, []).syncOnce();
    assert.equal(result.ok, true, result.message);
    assert.equal(open.filesAt('main').has(post.path), false, '내린 글은 지운다');
    await open.stop();
  });

  test('복원 동작은 주인만, 설정이 비어 있으면 받지 않는다', async () => {
    const restorer = {} as ArchiveRestoreService;
    const gh = new GithubGateway('me/cairn-archive', 't0ken', api);
    for (const action of [
      new RestorePreviewAction(gh, 'main', restorer, []),
      new RestoreAction(gh, 'main', restorer, []),
    ])
      await assert.rejects(action.run(new VisitorActor()), /관리자만/);
    for (const action of [
      new RestorePreviewAction(null, 'main', restorer, ['repo']),
      new RestoreAction(null, 'main', restorer, ['repo']),
    ]) {
      const result = await action.run(new OwnerActor('s', 'u'));
      assert.deepEqual([result.ok, result.details], [false, ['repo']]);
    }
  });

  test('연결 확인은 주인만, 결과에 private 여부와 브랜치 상태가 나온다', async () => {
    const check = new CheckAction(new GithubGateway('me/cairn-archive', 't0ken', api), 'main', []);
    await assert.rejects(check.run(new VisitorActor()), /권한으로만 할 수 있어요/);
    const result = await check.run(new OwnerActor('s', 'u'));
    assert.equal(result.ok, true);
    assert.ok(result.details.some((d) => d.includes('private')));
  });
});
