// 러너가 빌릴 수 있는 일의 도구를 정한다. 러너는 next_jobs로 가진 것을 알린다:
//   tools        실행할 수 있는 AI CLI (설치돼 있고 러너가 그 도구로 일할 줄 안다)
//   signin_tools 웹 로그인을 대신 돌릴 수 있는 CLI
//   own_logins   러너가 스스로 가진 로그인 (주인 컴퓨터의 환경 변수 등). 서버의 로그인이 없어도 일한다
// 서버는 쓸 수 있는 로그인과 지금 도는 일을 안다. 둘을 합쳐 SQL에서 거르므로, 러너는 할 수 없는 일을 빌렸다 돌려주지 않는다.
// 알리지 않은 값(null)은 거르지 않는다: 도구를 알리기 전의 러너.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 일을 빌려 줄 때만 쓴다
export class LeasePolicy {
  /**
   * 에이전트의 일을 맡길 수 있는 도구.
   * 서버의 로그인을 쓰는 도구 중 갱신 토큰이 쓸 때마다 바뀌는 것(rotating)은 공간에서 한 번에 하나만 돈다:
   * 둘이 같은 자격으로 동시에 갱신하면 늦은 쪽이 이미 쓴 갱신 토큰을 내밀어 로그인이 깨진다
   */
  static workTools(
    tools: readonly string[] | null,
    ownLogins: readonly string[],
    usableLogins: readonly string[],
    rotating: readonly string[],
    running: readonly string[],
  ): readonly string[] | null {
    if (tools === null) return null;
    return tools.filter(
      (tool) =>
        ownLogins.includes(tool) ||
        (usableLogins.includes(tool) && LeasePolicy.canStart(tool, ownLogins, rotating, running)),
    );
  }

  /**
   * 이 도구의 일을 하나 더 시작해도 되는가. busy는 지금 도는 것과 이번에 빌려 준 것의 도구:
   * 한 번의 next_jobs가 여러 개를 빌려 줄 때도 바뀌는 자격의 일은 하나만
   */
  static canStart(
    tool: string,
    ownLogins: readonly string[],
    rotating: readonly string[],
    busy: readonly string[],
  ): boolean {
    return ownLogins.includes(tool) || !(rotating.includes(tool) && busy.includes(tool));
  }

  /** 연결 확인을 맡길 수 있는 도구: 실행할 수 있고, 확인할 서버의 로그인이 쓸 수 있는 상태 */
  static testTools(
    tools: readonly string[] | null,
    usableLogins: readonly string[],
  ): readonly string[] | null {
    return tools === null ? null : tools.filter((tool) => usableLogins.includes(tool));
  }
}
