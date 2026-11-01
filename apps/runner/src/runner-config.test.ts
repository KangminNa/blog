import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ConfigProblem, RunnerConfig } from './runner-config';

const env = {
  CAIRN_RUNNER_URL: 'https://blog.example/',
  CAIRN_RUNNER_TOKEN: 'device-secret',
  CLAUDE_CODE_OAUTH_TOKEN: 'claude-secret',
};

describe('러너 설정', () => {
  test('주소의 끝 슬래시를 떼고 기본값을 채운다', () => {
    const config = RunnerConfig.fromEnv(env);
    assert.equal(config.mcpUrl, 'https://blog.example/mcp');
    assert.equal(config.cliPath, 'claude');
    assert.ok(config.skillsDir.endsWith('/skills'));
  });

  test('CLI 경로와 스킬 폴더를 바꿀 수 있다', () => {
    const config = RunnerConfig.fromEnv({
      ...env,
      CAIRN_RUNNER_CLI: '/opt/claude',
      CAIRN_SKILLS_DIR: '/opt/skills',
    });
    assert.equal(config.cliPath, '/opt/claude');
    assert.equal(config.skillsDir, '/opt/skills');
  });

  test('빠진 설정의 이름을 모두 알리고 값은 드러내지 않는다', () => {
    assert.throws(
      () => RunnerConfig.fromEnv({ CAIRN_RUNNER_TOKEN: 'device-secret' }),
      (error: Error) =>
        error instanceof ConfigProblem &&
        error.message.includes('CAIRN_RUNNER_URL') &&
        !error.message.includes('device-secret'),
    );
    assert.throws(
      () => RunnerConfig.fromEnv({ CAIRN_RUNNER_URL: env.CAIRN_RUNNER_URL }),
      /CAIRN_RUNNER_TOKEN/,
    );
  });

  test('Claude 토큰은 없어도 된다: 콘솔에 넣은 토큰을 서버에서 받는다', () => {
    const { CLAUDE_CODE_OAUTH_TOKEN: _, ...rest } = env;
    assert.equal(RunnerConfig.fromEnv(rest).claudeToken, null);
    assert.equal(
      RunnerConfig.fromEnv({ ...rest, CLAUDE_CODE_OAUTH_TOKEN: '  ' }).claudeToken,
      null,
    );
    assert.equal(RunnerConfig.fromEnv(env).claudeToken, 'claude-secret');
  });

  test('공백뿐인 값은 없는 것과 같다', () => {
    assert.throws(() => RunnerConfig.fromEnv({ ...env, CAIRN_RUNNER_TOKEN: '  ' }), ConfigProblem);
  });

  test('http(s) 주소가 아니면 시작하지 않는다', () => {
    for (const url of ['blog.example', 'ftp://blog.example', 'https://'])
      assert.throws(() => RunnerConfig.fromEnv({ ...env, CAIRN_RUNNER_URL: url }), ConfigProblem);
  });
});
