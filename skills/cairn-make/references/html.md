# HTML 결과물 (발표 · 표 · 문서)

발표 자료 · 표(엑셀) · 문서는 **HTML 파일 하나**로 낸다. 콘솔에서 "열기"로 바로 보이고, 폰에서도 열린다.
pptx · xlsx · docx는 지시에 그 형식이 적혀 있을 때만 만든다 ([slides.md](slides.md) · [documents.md](documents.md)).

공통:
- **파일 하나로 끝낸다.** `<style>` · `<script>` · 그림(SVG · data URI)을 모두 그 안에 넣는다. 옆 파일을 상대 경로로 잇지 않는다 (콘솔에서 열 때 옆 파일은 따라오지 않는다).
- 바깥 스크립트 · 글꼴 · CDN을 쓰지 않는다. 글꼴은 `system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`.
- 열린 페이지는 격리된다: 쿠키 · `localStorage` · 서버 API를 쓸 수 없다. 넣을 내용은 만들 때 다 넣는다.
- 이름은 내용을 알 수 있게 한국어로 짧게, 확장자 `.html` (`2026 계획 발표.html`). 페이지로 내보내는 일(지시의 `# 페이지`)이면 `index.html`.
- 아래 본보기를 **그대로 복사해 내용만 바꾼다.** 넘기기 · 정렬 · 인쇄 스크립트는 고치지 않는다.
- 확인: 칸에는 브라우저가 없다. 만든 뒤 파일을 다시 읽어 본다.
  - 닫히지 않은 태그, 빈 링크, `http`로 시작하는 스크립트 · 스타일 · 글꼴 주소가 없는지
  - 발표: 장마다 글이 5줄 · 120자 안팎인지 (넘치면 장을 나눈다)
  - 표: 데이터가 JSON으로 읽히는지 `python3 -c "import json,re,sys; t=open(sys.argv[1],encoding='utf-8').read(); d=json.loads(re.search(r'id=\"data\" type=\"application/json\">(.*?)</script>', t, re.S).group(1)); print(len(d['rows']), '줄')" 파일.html`

## 발표 (HTML 슬라이드)

`<section class="slide">` 하나가 한 장이다. ←/→ · 스페이스 · 클릭(오른쪽 절반 다음, 왼쪽 절반 이전) · 밀기로 넘기고, `F`는 전체 화면, 인쇄하면 한 장이 한 쪽(16:9)인 PDF가 된다.
한 장에 한 메시지, 제목(`h2`)은 결론 문장으로. 글은 3~5줄, 숫자는 `.big`으로 크게. 8~12장.

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>발표 제목</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #111; font-family: system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
  .deck { height: 100%; display: grid; place-items: center; }
  .slide { display: none; flex-direction: column; gap: .6em; width: min(100vw, calc(100vh * 16 / 9)); aspect-ratio: 16 / 9; padding: 5% 7%; overflow: hidden; background: #fff; color: #111; font-size: min(2.1vw, 3.7vh); }
  .slide.on { display: flex; }
  .slide h1 { margin: auto 0 0; font-size: 2.6em; line-height: 1.2; }
  .slide h2 { margin: 0 0 .3em; font-size: 1.7em; line-height: 1.25; }
  .slide p, .slide li { margin: 0 0 .45em; line-height: 1.5; }
  .slide ul { margin: 0; padding-left: 1.2em; }
  .slide .sub { color: #555; font-size: 1.1em; }
  .slide .big { font-size: 3.4em; font-weight: 700; line-height: 1.1; }
  .slide .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 6%; }
  .slide table { border-collapse: collapse; width: 100%; font-size: .85em; }
  .slide th, .slide td { border-bottom: 1px solid #ddd; padding: .35em .5em; text-align: left; }
  .slide .src { margin-top: auto; color: #777; font-size: .55em; }
  .slide footer { display: flex; justify-content: space-between; color: #777; font-size: .55em; }
  .nav { position: fixed; right: 12px; bottom: 12px; display: flex; align-items: center; gap: 8px; color: #ccc; font-size: 13px; }
  .nav button { min-width: 36px; min-height: 36px; border: 1px solid #555; border-radius: 6px; background: #222; color: #fff; font-size: 18px; cursor: pointer; }
  @media print {
    @page { size: 13.333in 7.5in; margin: 0; }
    html, body { height: auto; background: #fff; }
    .deck { display: block; }
    .slide { display: flex !important; width: 13.333in; height: 7.5in; aspect-ratio: auto; font-size: 20pt; break-after: page; }
    .nav { display: none; }
  }
</style>
</head>
<body>
<main class="deck" id="deck">
  <section class="slide on">
    <h1>결론을 한 문장으로</h1>
    <p class="sub">부제 · 무엇을 다루는지</p>
    <footer><span>발표자 · 2026-11-14</span><span></span></footer>
  </section>
  <section class="slide">
    <h2>핵심 숫자가 말하는 것</h2>
    <p class="big">37%</p>
    <p>이 숫자가 왜 중요한지 한 줄</p>
    <p class="src">출처: 기관 이름, 2026-10 (https://example.com/source)</p>
  </section>
  <section class="slide">
    <h2>두 가지를 나란히</h2>
    <div class="cols">
      <div><b>지금</b><ul><li>항목</li><li>항목</li></ul></div>
      <div><b>바꾸면</b><ul><li>항목</li><li>항목</li></ul></div>
    </div>
  </section>
</main>
<nav class="nav" aria-label="슬라이드 넘기기">
  <button type="button" id="prev" aria-label="이전">‹</button>
  <span id="count"></span>
  <button type="button" id="next" aria-label="다음">›</button>
</nav>
<script>
  const slides = [...document.querySelectorAll('.slide')];
  let at = 0;
  function show(n) {
    at = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, k) => s.classList.toggle('on', k === at));
    document.getElementById('count').textContent = `${at + 1} / ${slides.length}`;
  }
  document.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) show(at + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) show(at - 1);
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
    else if (e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen?.().catch(() => {});
    else return;
    e.preventDefault();
  });
  document.getElementById('prev').onclick = () => show(at - 1);
  document.getElementById('next').onclick = () => show(at + 1);
  document.getElementById('deck').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    show(e.clientX > innerWidth / 2 ? at + 1 : at - 1);
  });
  let touchX = null;
  addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) show(dx < 0 ? at + 1 : at - 1);
    touchX = null;
  });
  slides.forEach((s, k) => { const n = s.querySelector('footer span:last-child'); if (n) n.textContent = `${k + 1}`; });
  show(0);
</script>
</body>
</html>
```

## 표 (엑셀 대신)

데이터는 `<script id="data" type="application/json">`에 **열 이름과 줄**로만 넣는다. 표 · 정렬 · 합계 · 막대 차트 · CSV 받기는 스크립트가 그린다.
숫자는 숫자로(따옴표 없이) 넣는다. 머리를 누르면 정렬, "CSV로 받기"는 엑셀에서 여는 파일(UTF-8, 한글 깨짐 없음)이다.
차트를 그릴 열은 `chart`에 적는다 (`label`: 이름 열, `value`: 숫자 열). 단위 · 기준일 · 출처는 `note`에.
**같은 데이터를 `표 이름.csv`로도 결과물 폴더에 둔다** (UTF-8 BOM, python `csv` 모듈). 콘솔에서 그 이름 그대로 내려받아 엑셀에서 연다.
페이지 안의 "CSV로 받기"는 격리된 화면이라 브라우저가 파일 이름을 `download`로 저장할 수 있다.

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>표 제목</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; color: #111; font-family: system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
  main { max-width: 1040px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .note { margin: 0 0 16px; color: #666; font-size: 13px; }
  .bar { display: flex; gap: 8px; margin: 0 0 12px; }
  .bar button { padding: 6px 12px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; font: inherit; font-size: 13px; }
  .wrap { overflow-x: auto; border: 1px solid #e5e5e5; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #eee; text-align: left; white-space: nowrap; }
  th { position: sticky; top: 0; background: #f7f7f7; cursor: pointer; user-select: none; }
  th[aria-sort="ascending"]::after { content: " ▲"; } th[aria-sort="descending"]::after { content: " ▼"; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; background: #fafafa; }
  svg { display: block; width: 100%; height: auto; margin: 20px 0 0; }
  @media print { .bar { display: none; } .wrap { overflow: visible; border: 0; } th { position: static; } }
</style>
</head>
<body>
<main>
  <h1 id="title"></h1>
  <p class="note" id="note"></p>
  <div class="bar"><button type="button" id="csv">CSV로 받기</button><button type="button" onclick="print()">인쇄 · PDF</button></div>
  <div class="wrap"><table id="table"><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
  <div id="chart"></div>
</main>
<script id="data" type="application/json">
{
  "title": "지역별 매출 (2026년 3분기)",
  "note": "단위: 백만 원 · 기준일 2026-09-30 · 출처: 매출표.xlsx",
  "columns": ["지역", "매출", "전년 대비(%)"],
  "rows": [["서울", 420, 12.5], ["부산", 180, -3.1], ["대구", 95, 4.0]],
  "total": ["매출"],
  "chart": { "label": "지역", "value": "매출" }
}
</script>
<script>
  const d = JSON.parse(document.getElementById('data').textContent);
  const isNum = (c) => d.rows.every((r) => typeof r[c] === 'number' || r[c] === null);
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : v ?? '');
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  document.getElementById('title').textContent = d.title;
  document.title = d.title;
  document.getElementById('note').textContent = d.note || '';
  const table = document.getElementById('table');
  const nums = d.columns.map((_, c) => isNum(c));
  table.tHead.innerHTML = `<tr>${d.columns.map((h, c) => `<th class="${nums[c] ? 'num' : ''}" data-c="${c}">${esc(h)}</th>`).join('')}</tr>`;
  function body(rows) {
    table.tBodies[0].innerHTML = rows.map((r) => `<tr>${r.map((v, c) => `<td class="${nums[c] ? 'num' : ''}">${esc(fmt(v))}</td>`).join('')}</tr>`).join('');
  }
  if (d.total && d.total.length) {
    table.tFoot.innerHTML = `<tr>${d.columns.map((h, c) => {
      if (c === 0) return '<td>합계</td>';
      if (!d.total.includes(h)) return '<td></td>';
      return `<td class="num">${fmt(d.rows.reduce((s, r) => s + (r[c] || 0), 0))}</td>`;
    }).join('')}</tr>`;
  }
  let rows = [...d.rows];
  body(rows);
  table.tHead.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;
    const c = Number(th.dataset.c);
    const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    table.tHead.querySelectorAll('th').forEach((x) => x.removeAttribute('aria-sort'));
    th.setAttribute('aria-sort', dir);
    const sign = dir === 'ascending' ? 1 : -1;
    rows = [...d.rows].sort((a, b) => (nums[c] ? (a[c] ?? 0) - (b[c] ?? 0) : String(a[c]).localeCompare(String(b[c]), 'ko')) * sign);
    body(rows);
  });
  document.getElementById('csv').onclick = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [d.columns, ...d.rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(`\ufeff${csv}`)}`;
    a.download = `${d.title}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
  };
  if (d.chart) {
    const L = d.columns.indexOf(d.chart.label), V = d.columns.indexOf(d.chart.value);
    const max = Math.max(...d.rows.map((r) => Math.abs(r[V] || 0)), 1);
    const h = 28, w = 640, left = 120;
    const bars = d.rows.map((r, k) => {
      const len = Math.round((Math.abs(r[V] || 0) / max) * (w - left - 70));
      return `<text x="${left - 8}" y="${k * h + 19}" text-anchor="end" font-size="13">${esc(r[L])}</text>` +
        `<rect x="${left}" y="${k * h + 6}" width="${len}" height="${h - 12}" fill="#111"></rect>` +
        `<text x="${left + len + 6}" y="${k * h + 19}" font-size="12" fill="#555">${esc(fmt(r[V]))}</text>`;
    }).join('');
    document.getElementById('chart').innerHTML =
      `<svg viewBox="0 0 ${w} ${d.rows.length * h + 8}" role="img" aria-label="${esc(d.chart.value)} 막대 차트" font-family="system-ui, sans-serif">${bars}</svg>`;
  }
</script>
</body>
</html>
```

## 문서 (보고서 · 기획서)

글은 HTML로 바로 쓴다. 맨 위 제목 · 요약(3줄) → 본문(`h2` 절) → 출처. 인쇄하면 A4 PDF가 된다.

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>문서 제목</title>
<style>
  body { margin: 0; padding: 32px 16px 64px; color: #111; font-family: system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; line-height: 1.7; }
  article { max-width: 760px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 28px; line-height: 1.3; }
  .meta { margin: 0 0 24px; color: #666; font-size: 14px; }
  .summary { margin: 0 0 32px; padding: 16px 20px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa; }
  .summary ul { margin: 0; padding-left: 1.2em; }
  h2 { margin: 36px 0 8px; font-size: 20px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; }
  th, td { padding: 6px 8px; border: 1px solid #ddd; text-align: left; }
  th { background: #f5f5f5; }
  .sources { margin-top: 40px; color: #555; font-size: 13px; }
  .sources a { color: inherit; word-break: break-all; }
  @media print { @page { size: A4; margin: 18mm 16mm; } body { padding: 0; } h2 { break-after: avoid; } table, figure { break-inside: avoid; } }
</style>
</head>
<body>
<article>
  <h1>결론이 드러나는 제목</h1>
  <p class="meta">작성 2026-11-14 · 대상 · 범위</p>
  <section class="summary" aria-label="요약">
    <ul><li>핵심 하나</li><li>핵심 둘</li><li>권하는 것</li></ul>
  </section>
  <h2>1. 배경</h2>
  <p>본문</p>
  <h2>2. 분석</h2>
  <table><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>예</td><td>1</td></tr></tbody></table>
  <h2>3. 권하는 것</h2>
  <p>본문</p>
  <section class="sources" aria-label="출처">
    <b>출처</b>
    <ol><li><a href="https://example.com" target="_blank" rel="noopener">기관 · 제목 (확인 2026-11-14)</a></li></ol>
  </section>
</article>
</body>
</html>
```
