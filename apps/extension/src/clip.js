// 서버가 받는 길이에 맞춰 자른다. 길이는 서버가 세는 방식(UTF-16 단위)으로 센다.
/** 앞에서부터 max 글자까지. 짝 문자(이모지 등)를 반으로 자르지 않는다 */
export function clip(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
