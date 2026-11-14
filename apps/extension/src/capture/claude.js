// Claude (claude.ai) 대화 읽기. 화면 모양이 바뀌면 이 파일의 선택자만 고친다 (maintainer가 점검).
//   대화 주소   /chat/<uuid>
//   사람 메시지 [data-testid="user-message"]
//   AI 답       .font-claude-response  (옛 화면 .font-claude-message)
//   답을 쓰는 중 [data-is-streaming="true"]
//   제목        문서 제목 "<제목> - Claude"
const PERSON = '[data-testid="user-message"]';
const AI = '.font-claude-response, .font-claude-message';

globalThis.cairnWatch({
  tool: 'claude-web',
  conversationId: (path) => /\/chat\/([\w-]+)/.exec(path)?.[1] ?? null,
  streaming: () => document.querySelector('[data-is-streaming="true"]') !== null,
  title: () => {
    const title = document.title.trim();
    return title === 'Claude' ? '' : title.replace(/\s+-\s+Claude$/, '');
  },
  messages: () => {
    const found = Array.from(document.querySelectorAll(`${PERSON}, ${AI}`));
    // 답 안에 같은 표시가 또 있으면(옛 · 새 화면이 겹칠 때) 바깥 것만
    return found
      .filter((el) => !found.some((other) => other !== el && other.contains(el)))
      .map((el) => ({ role: el.matches(PERSON) ? 'person' : 'ai', text: el.innerText }));
  },
});
