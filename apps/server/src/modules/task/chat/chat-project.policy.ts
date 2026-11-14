import { RuleViolation } from '../../platform';

// 대화의 프로젝트 (task.chats.project, 2차 1-1): git 주소 여러 모양을 "host/owner/repo" 하나로 맞춘다.
// 내 컴퓨터의 훅(cairn connect)이 git remote를 같은 규칙으로 맞춰 agent_updates를 거른다:
//   앞의 git+ 를 떼고, scp 모양(user@host:path)과 주소 모양(scheme://user@host:port/path)을 받아, 끝의 .git과 / 를 떼고, 모두 소문자로
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class ChatProject {
  static readonly MAX = 200;
  private static readonly SCP = /^[\w.-]+@([^:/\s]+):(.+)$/;
  private static readonly URL =
    /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/i;
  private static readonly SHAPE = /^[a-z0-9.-]+(\/[a-z0-9._-]+){2,}$/;

  /** 맞춘 값. 비었으면 null, git 주소 모양이 아니면 RuleViolation */
  static of(raw: string | null): string | null {
    const text = raw?.trim().replace(/^git\+/i, '') ?? '';
    if (!text) return null;
    const found = ChatProject.SCP.exec(text) ?? ChatProject.URL.exec(text);
    const [, host = '', path = ''] = found ?? [];
    const project = `${host}/${path.replace(/\/+$/, '').replace(/\.git$/i, '')}`.toLowerCase();
    if (!found || !ChatProject.SHAPE.test(project) || project.length > ChatProject.MAX)
      throw new RuleViolation('프로젝트는 git 주소예요 (예: github.com/<owner>/<repo>)');
    return project;
  }
}
