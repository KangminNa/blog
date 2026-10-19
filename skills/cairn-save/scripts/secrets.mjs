// 비밀값 무늬. 근거 묶음을 만들 때 지우고(evidence.mjs), 초안에 남았는지 검사한다(check.mjs).
// 서버의 2차 제거(apps/server/src/modules/vault/session/sensitive.policy.ts)와 같은 무늬를 쓴다. 한쪽을 바꾸면 함께 고친다.

/** [이름, 무늬]. 무늬에 이름 붙은 그룹 keep이 있으면 그 부분(예: password=)은 남기고 값만 지운다 */
export const SECRET_RULES = [
  [
    '개인 키',
    /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
  ],
  ['GitHub 토큰', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
  ['AWS 키', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['Slack 토큰', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['Slack 웹훅', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g],
  ['Anthropic API 키', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI API 키', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ['Google API 키', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Cairn 토큰', /\bcairn_(?:at|rt|dt)_[A-Za-z0-9_-]{20,}/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  [
    '비밀번호·키 값',
    /(?<keep>\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret|token)\b["']?\s*[:=]\s*["']?)(?!\[지움|process\.env|(?:string|number|null|undefined|true|false)\b)(?=[^\s"'`,;]*\d|[^\s"'`,;]{16})[^\s"'`,;]{6,}/gi,
  ],
];

/** 비밀값을 [지움: 종류]로 바꾼 글과, 지운 종류들 */
export function redact(text) {
  const found = [];
  let cleaned = text;
  for (const [label, pattern] of SECRET_RULES) {
    cleaned = cleaned.replace(pattern, (...args) => {
      found.push(label);
      const groups = args.at(-1);
      return `${(groups && typeof groups === 'object' && groups.keep) || ''}[지움: ${label}]`;
    });
  }
  return { text: cleaned, found };
}
