// 응답의 기반. 채널(REST·MCP)과 보는 사람(방문자·관리자·AI)에 맞춰 무엇을 보여줄지 정한다.
// Entity나 View로만 만들고(`static of`), 응답을 만들면서 데이터를 다시 조회하지 않는다.
export abstract class BaseResponse {
  abstract toJSON(): object;
}
