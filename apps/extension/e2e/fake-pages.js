// 시험용 가짜 페이지. 각 사이트의 대화 화면 모양(사이트 파일의 선택자)을 흉내 낸다.
// 답을 쓰는 중 표시가 있다가 1.5초 뒤에 사라지면서 답의 마지막 문단이 붙는다 (끝난 뒤의 대화를 올리는지 본다).

const page = (title, body, finish) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${title}</title></head>
<body><main>${body}</main>
<script>setTimeout(() => { ${finish} }, 1500);</script>
</body></html>`;

export const CHATGPT = page(
  '피보나치 함수',
  `<div data-message-author-role="user"><div class="whitespace-pre-wrap">피보나치 함수를 짜 줘</div></div>
   <div data-message-author-role="assistant"><div class="markdown"><p>여기 있어요.</p>
     <pre><code>const fib = (n) =&gt; (n &lt; 2 ? n : fib(n - 1) + fib(n - 2));</code></pre></div></div>
   <button data-testid="stop-button">멈춤</button>`,
  `document.querySelector('[data-testid="stop-button"]').remove();
   const p = document.createElement('p');
   p.textContent = '끝까지 썼어요.';
   document.querySelector('.markdown').append(p);`,
);

export const CLAUDE = page(
  '회의록 요약 - Claude',
  `<div data-testid="user-message"><p>회의록을 세 줄로 요약해 줘</p></div>
   <div data-is-streaming="true"><div class="font-claude-response"><p>첫째, 일정을 미뤘어요.</p></div></div>`,
  `const answer = document.querySelector('.font-claude-response');
   for (const line of ['둘째, 예산을 늘렸어요.', '셋째, 담당을 정했어요.']) {
     const p = document.createElement('p');
     p.textContent = line;
     answer.append(p);
   }
   document.querySelector('[data-is-streaming]').setAttribute('data-is-streaming', 'false');`,
);

export const GEMINI = page(
  'Gemini',
  `<nav><div class="conversation selected"><div class="conversation-title">부산 여행</div></div></nav>
   <user-query><div class="query-text">부산 여행 일정을 짜 줘</div></user-query>
   <model-response><message-content><p>첫째 날은 해운대예요.</p></message-content></model-response>
   <button class="send-button stop">멈춤</button>`,
  `const p = document.createElement('p');
   p.textContent = '둘째 날은 감천마을이에요.';
   document.querySelector('message-content').append(p);
   document.querySelector('.send-button').classList.remove('stop');`,
);

export const ARTICLE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>읽을 만한 글</title></head>
<body><nav>메뉴</nav><article><h1>읽을 만한 글</h1>
<p>첫 문단이에요.</p><p id="quote">이 문단을 골라 보관해요.</p></article></body></html>`;
