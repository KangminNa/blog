// 일꾼이 정해진 간격마다 돌리는 일. 앞의 실행이 끝나지 않았으면 이번 차례는 건너뛴다.
export abstract class BaseJob {
  /** 목록 파일의 `job:<이름>`과 같아야 한다 */
  abstract readonly name: string;
  abstract run(): Promise<void>;
}
