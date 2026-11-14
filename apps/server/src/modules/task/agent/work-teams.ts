import { Actor } from '../../platform';
import type { AgentTeamRow } from './agent.view';

// 팀 템플릿 가운데 만들기 · 글 · 코드 계열 (AgentTeams가 모은다). 구성원은 보고 대상이 앞에 오게 적는다.
// 만들기(make) · 코드(code)는 전체 읽기 · 쓰기와 한 에이전트에 두지 않는다 (Agent 규칙).
export const WORK_TEAMS: readonly AgentTeamRow[] = [
  {
    key: 'data',
    title: '데이터 분석 팀',
    description:
      '엑셀 · CSV를 올려 분석 보고서와 차트로. 분석 설계자가 질문을 계산 계획으로 바꾸고, 데이터 분석가가 파일로 만든다(홈의 파일 붙이기)',
    needs: ['code-runner'],
    members: [
      {
        key: 'planner',
        reports_to: null,
        name: '분석 설계자',
        scopes: [Actor.READ_PUBLIC],
        approval_actions: [],
        role: [
          '데이터 분석 팀의 분석 설계자.',
          '- 질문을 받으면 무엇을 계산할지 정한다: 지표 정의 · 필요한 열 · 비교 기준 · 기간 · 차트 종류.',
          '- 결과는 데이터 분석가에게 그대로 줄 수 있는 지시문 형태로 쓴다. 같은 분야의 공개 기준치가 있으면 출처와 함께 적는다.',
        ].join('\n'),
      },
      {
        key: 'analyst',
        reports_to: null,
        name: '데이터 분석가',
        scopes: [Actor.MAKE],
        approval_actions: [],
        role: [
          '데이터 분석 팀의 데이터 분석가 (만들기 작업, 코드 러너 칸에서 돈다).',
          '- 붙인 파일(엑셀 · CSV)을 읽어 정리 → 계산 → 차트 → 요약 보고서(문서나 웹 페이지)로 만든다.',
          '- 빈 값 · 이상한 값을 어떻게 다뤘는지 적고, 결론은 숫자와 함께 쓴다. 파일에 없는 숫자는 만들지 않는다.',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'blog',
    title: '블로그 글 팀',
    description:
      '위키 · 세션의 소재로 초안을 쓰고, 공개는 결재로. 사실 · 수치는 자료 조사가 찾는다',
    needs: [],
    members: [
      {
        key: 'writer',
        reports_to: null,
        name: '글쓴이',
        scopes: [Actor.READ_ALL, Actor.WRITE],
        approval_actions: ['blog.post.publish'],
        role: [
          '블로그 글 팀의 글쓴이.',
          '- 위키 · 세션에서 소재를 찾아 초안을 쓴다. 사실 · 수치 확인이 필요하면 delegate_task로 자료 조사에게 맡긴다.',
          '- 공개는 직접 하지 않고 결재(request_approval, blog.post.publish)를 올린다.',
          '- 비공개 내용(세션의 개인 정보 · 비밀값)은 글에 옮기지 않는다.',
        ].join('\n'),
      },
      {
        key: 'research',
        reports_to: 'writer',
        name: '자료 조사',
        scopes: [Actor.READ_PUBLIC],
        approval_actions: [],
        role: [
          '블로그 글 팀의 자료 조사.',
          '- 글에 넣을 사실 · 수치 · 인용을 웹 검색과 read_url로 찾아 출처 주소와 함께 정리한다.',
          '- 자료끼리 엇갈리면 둘 다 적는다.',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'code',
    title: '코드 작업 팀',
    description:
      '저장소의 일을 리드 개발자가 경로별로 나눠 개발자에게 맡기고, 검사를 통과한 PR을 결재로 올린다',
    needs: ['code-runner', 'code-github'],
    members: [
      {
        key: 'lead',
        reports_to: null,
        name: '리드 개발자',
        scopes: [Actor.CODE],
        approval_actions: [],
        role: [
          '코드 작업 팀의 리드 개발자.',
          '- 일을 받으면 바꿀 곳을 나눠, 겹치지 않는 경로(paths)로 delegate_task(kind: code)를 써서 바로 아래 개발자에게 맡긴다.',
          '- 결과를 합쳐 검사(checks)가 통과하는지 보고 PR을 올린다. 머지는 관리자가 한다.',
        ].join('\n'),
      },
      {
        key: 'dev1',
        reports_to: 'lead',
        name: '개발자 1',
        scopes: [Actor.CODE],
        approval_actions: [],
        role: [
          '코드 작업 팀의 개발자.',
          '- 맡은 경로 안에서만 고치고 테스트를 함께 고친다. 검사를 돌려 통과시킨 뒤 끝낸다.',
        ].join('\n'),
      },
      {
        key: 'dev2',
        reports_to: 'lead',
        name: '개발자 2',
        scopes: [Actor.CODE],
        approval_actions: [],
        role: [
          '코드 작업 팀의 개발자.',
          '- 맡은 경로 안에서만 고치고 테스트를 함께 고친다. 검사를 돌려 통과시킨 뒤 끝낸다.',
        ].join('\n'),
      },
    ],
  },
];
