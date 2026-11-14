import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Agent } from '../agent/agent';
import type { AgentRow } from '../task.tables';
import { ChatRoute } from './chat-route.policy';

// 배정의 판단 (2차 1-5): 후보 · 글로 한 답 · 배정 일의 답 읽기. DB 없이 돈다.

function agent(id: string, more: Partial<AgentRow> = {}): Agent {
  return Agent.restore({
    id,
    version: 1,
    space_id: 'space',
    name: `${id} 팀`,
    role: `${id}의 일을 해요\n자세한 규칙`,
    tool: 'claude',
    reports_to: null,
    reviewer_id: null,
    status: Agent.ACTIVE,
    deleted_at: null,
    ...more,
  } as AgentRow);
}

const blog = agent('blog');
const research = agent('research');

describe('ChatRoute.candidates', () => {
  test('관리자 바로 아래 · 쓰는 에이전트만. 팀원 · 멈춤 · 휴지통 · 다른 에이전트의 검토자는 맡지 않는다', () => {
    const reviewer = agent('reviewer', { tool: 'codex' });
    const paired = agent('paired', { reviewer_id: 'reviewer' });
    const member = agent('member', { reports_to: 'blog' });
    const paused = agent('paused', { status: Agent.PAUSED });
    const gone = agent('gone', { deleted_at: new Date() });
    const found = ChatRoute.candidates([blog, research, reviewer, paired, member, paused, gone]);
    assert.deepEqual(
      found.map((a) => a.id),
      ['blog', 'research', 'paired'],
    );
  });

  test('맡는 일은 역할의 첫 줄', () => {
    assert.equal(blog.duty, 'blog의 일을 해요');
    assert.equal(ChatRoute.listOf([blog]), '- blog · blog 팀: blog의 일을 해요');
  });
});

describe('ChatRoute.chosen', () => {
  test('번호 · 이름(띄어쓰기 · 대소문자 무시)이면 그 에이전트, 아니면 null', () => {
    const choices = [blog, research];
    assert.equal(ChatRoute.chosen('2', choices)?.id, 'research');
    assert.equal(ChatRoute.chosen(' 1번 ', choices)?.id, 'blog');
    assert.equal(ChatRoute.chosen('research팀', choices)?.id, 'research');
    assert.equal(ChatRoute.chosen('3번', choices), null);
    assert.equal(ChatRoute.chosen('사진은 빼고 해 줘', choices), null);
  });
});

describe('ChatRoute.parse', () => {
  const candidates = [blog, research];

  test('고른 답: 앞뒤 글 · 코드 울타리가 있어도 JSON을 읽는다. 받을 것은 아는 것만', () => {
    const text = '```json\n{"agent":"research","reason":"조사예요","deliver":"html"}\n```';
    assert.deepEqual(ChatRoute.parse(text, candidates), {
      kind: 'agent',
      agent: research,
      reason: '조사예요',
      deliver: 'html',
    });
    const named = ChatRoute.parse('{"agent":"blog 팀","deliver":"pdf"}', candidates);
    assert.equal(named.kind === 'agent' && named.agent.id, 'blog');
    assert.equal(named.kind === 'agent' && named.deliver, null);
  });

  test('묻는 답: 고를 것은 후보 안에서만. 둘 미만이면 후보 전부', () => {
    const asked = ChatRoute.parse(
      '{"question":"글로 할까요?","choices":["blog","research"]}',
      candidates,
    );
    assert.deepEqual(asked, { kind: 'question', question: '글로 할까요?', choices: candidates });
    const narrow = ChatRoute.parse(
      '{"question":"어디?","choices":["blog","outsider"]}',
      candidates,
    );
    assert.equal(narrow.kind === 'question' && narrow.choices.length, 2);
    const ordered = ChatRoute.parse(
      '{"question":"어디?","choices":["research","blog 팀","research"]}',
      candidates,
    );
    assert.deepEqual(
      ordered.kind === 'question' && ordered.choices.map((a) => a.id),
      ['research', 'blog'],
      'AI가 준 순서대로, 겹친 것은 한 번',
    );
  });

  test('후보 밖의 에이전트 · 읽지 못하는 답 · 빈 답은 서버의 질문 (후보 전부)', () => {
    for (const text of ['{"agent":"outsider"}', '맡길게요', '', '{"agent":', '[1,2]']) {
      assert.deepEqual(ChatRoute.parse(text, candidates), {
        kind: 'question',
        question: ChatRoute.QUESTION,
        choices: candidates,
      });
    }
  });
});
