// 웹 AI 대화 지켜보기 (콘텐츠 스크립트. 사이트 파일보다 먼저 읽힌다).
// 화면이 한동안(기본 20초) 조용하고 답을 쓰는 중이 아니면 답이 끝났다고 보고,
// 대화(제목 + 위에서 아래로의 메시지)를 서비스 워커로 보낸다. 올릴지 · 같은 내용인지는 서비스 워커가 정한다.
// 사이트마다 다른 것(주소의 대화 id, 답을 쓰는 중 표시, 메시지 위치)은 그 사이트의 파일
// (chatgpt.js · claude.js · gemini.js)에만 둔다. 읽기만 한다: 페이지의 어떤 것도 누르거나 고치지 않는다.

/**
 * @param {object} site
 * @param {'chatgpt-web' | 'claude-web' | 'gemini-web'} site.tool save_transcript의 tool
 * @param {(path: string) => string | null} site.conversationId 주소의 경로 → 대화 id. 대화가 아닌 페이지면 null
 * @param {() => boolean} site.streaming 답을 쓰는 중인가
 * @param {() => string} site.title 대화 제목 (모르면 빈 글자)
 * @param {() => { role: 'person' | 'ai', text: string }[]} site.messages 화면의 메시지들 (위에서 아래로)
 */
globalThis.cairnWatch = (site) => {
  let quietMs = 20_000;
  let timer;
  /** 마지막으로 보낸 대화. 같으면 다시 보내지 않는다 */
  let sent = '';

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(check, quietMs);
  }

  function check() {
    const id = site.conversationId(location.pathname);
    if (!id) return;
    if (site.streaming()) {
      schedule();
      return;
    }
    const messages = site.messages().filter((m) => m.role && m.text.trim());
    if (messages.length === 0) return;
    const title = site.title();
    const signature = JSON.stringify([id, title, messages]);
    if (signature === sent) return;
    chrome.runtime
      .sendMessage({ type: 'transcript', tool: site.tool, conversationId: id, title, messages })
      .then((reply) => {
        // 꺼져 있거나 연결이 없었으면 기억하지 않는다 (켜면 다음 변화 때 보낸다)
        if (reply?.ok && reply.status !== 'off') sent = signature;
      })
      // 확장을 다시 읽으면 이 페이지의 스크립트는 끊긴다. 페이지를 새로 고치면 다시 붙는다
      .catch(() => {});
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  chrome.runtime
    .sendMessage({ type: 'watch' })
    .then((reply) => {
      if (reply?.quietMs > 0) quietMs = reply.quietMs;
    })
    .catch(() => {})
    .finally(schedule);
};
