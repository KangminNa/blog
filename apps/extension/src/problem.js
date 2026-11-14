// 화면(팝업)에 그대로 보여 줄 실패. 서버가 거절했으면 그 문구와 코드를 싣는다.
// 그 밖의 오류(코드의 실수 등)는 화면에 내부 문구를 보이지 않고 짧은 말로 바꾼다 (describe).
export class Problem extends Error {
  /**
   * @param {string} message 화면에 보일 문구
   * @param {string | null} code 서버의 거절 코드. 없으면 null
   */
  constructor(message, code = null) {
    super(message);
    this.name = 'Problem';
    this.code = code;
  }
}

/** 팝업에 보일 문구 */
export function describe(error) {
  return error instanceof Problem ? error.message : '처리하지 못했어요';
}
