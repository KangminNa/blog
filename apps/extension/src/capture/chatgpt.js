// ChatGPT (chatgpt.com) 대화 읽기. 화면 모양이 바뀌면 이 파일의 선택자만 고친다 (maintainer가 점검).
//   대화 주소   /c/<id>  (GPT 안의 대화는 /g/<gpt>/c/<id>)
//   메시지      [data-message-author-role="user" | "assistant"]  위에서 아래로
//   답을 쓰는 중 멈춤 단추 [data-testid="stop-button"]
//   제목        문서 제목 (새 대화는 "ChatGPT")
const ROLES = { user: 'person', assistant: 'ai' };

globalThis.cairnWatch({
  tool: 'chatgpt-web',
  conversationId: (path) => /\/c\/([\w-]+)/.exec(path)?.[1] ?? null,
  streaming: () => document.querySelector('[data-testid="stop-button"]') !== null,
  title: () => {
    const title = document.title.trim();
    return title === 'ChatGPT' ? '' : title.replace(/\s+[-|]\s+ChatGPT$/, '');
  },
  messages: () =>
    Array.from(document.querySelectorAll('[data-message-author-role]'), (el) => ({
      role: ROLES[el.getAttribute('data-message-author-role')] ?? null,
      text: el.innerText,
    })),
});
