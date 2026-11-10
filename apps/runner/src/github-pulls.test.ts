import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { GitHubPulls, PullRefused } from './github-pulls';
import { FakeGithubApi } from './testing/fake-github-api';

// 러너가 여는 PR (가짜 GitHub REST로).

const TOKEN = 'github_pat_unit_0123456789';
let github: FakeGithubApi;

before(async () => {
  github = await FakeGithubApi.start(TOKEN);
});
after(() => github.close());

describe('GitHubPulls', () => {
  test('없으면 draft PR을 열고, 같은 브랜치의 열린 PR이 있으면 본문만 고친다 (PR은 하나)', async () => {
    const pulls = GitHubPulls.of(github.url, TOKEN, 'https://github.com/me/app.git');
    const first = await pulls.ensure('cairn/a', 'main', '제목', '본문 1');
    const again = await pulls.ensure('cairn/a', 'main', '제목', '본문 2');
    assert.equal(again.number, first.number);
    assert.match(first.url, /\/me\/app\/pull\/1$/);
    assert.deepEqual(
      github.open.map((p) => [p.head, p.base, p.draft]),
      [['cairn/a', 'main', true]],
    );
    assert.deepEqual(
      github.calls.map((c) => `${c.method} ${c.path}`),
      [
        'GET /repos/me/app/pulls',
        'POST /repos/me/app/pulls',
        'GET /repos/me/app/pulls',
        'PATCH /repos/me/app/pulls/1',
      ],
    );
  });

  test('토큰이 틀리면 PullRefused, 저장소 주소가 아니면 PullRefused', async () => {
    const wrong = GitHubPulls.of(github.url, 'nope', 'https://github.com/me/app');
    await assert.rejects(wrong.ensure('cairn/b', 'main', 't', 'b'), PullRefused);
    assert.throws(() => GitHubPulls.of(github.url, TOKEN, 'https://github.com/only'), PullRefused);
  });
});
