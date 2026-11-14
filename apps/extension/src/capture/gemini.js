// Gemini (gemini.google.com) 대화 읽기. 화면 모양이 바뀌면 이 파일의 선택자만 고친다 (maintainer가 점검).
//   대화 주소   /app/<id>  (여러 계정이면 /u/<n>/app/<id>)
//   사람 메시지 <user-query>의 .query-text
//   AI 답       <model-response>의 <message-content>
//   답을 쓰는 중 멈춤 단추 (.send-button.stop, 멈춤 아이콘, 영어 화면의 이름)
//   제목        옆 목록에서 고른 대화 (.conversation.selected .conversation-title)
const STOP = [
  '.send-button.stop',
  'button mat-icon[fonticon="stop"]',
  'button[aria-label="Stop response"]',
].join(', ');

globalThis.cairnWatch({
  tool: 'gemini-web',
  conversationId: (path) => /\/app\/([\w-]+)/.exec(path)?.[1] ?? null,
  streaming: () => document.querySelector(STOP) !== null,
  title: () =>
    document.querySelector('.conversation.selected .conversation-title')?.innerText ?? '',
  messages: () =>
    Array.from(document.querySelectorAll('user-query, model-response'), (el) => {
      const person = el.localName === 'user-query';
      const body = el.querySelector(person ? '.query-text' : 'message-content') ?? el;
      return { role: person ? 'person' : 'ai', text: body.innerText };
    }),
});
