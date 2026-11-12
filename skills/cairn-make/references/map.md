# 지도로 답하기 (페이지)

장소가 둘 이상 나오는 답(코스 · 맛집 · 여행 · 동선)이나 지시가 지도를 말하면 페이지에 지도를 넣는다. 지도는 [page.md](page.md)의 규칙 위에 얹는다.

지도는 두 겹이다.

- **약도**: 페이지 안에서 CSS로 그린다. 길은 없고 장소끼리의 방향 · 거리 · 순서를 보여 준다. 밖에서 아무것도 받지 않아 언제나 뜬다.
- **실제 지도**: 보는 사람의 브라우저가 지도 라이브러리(Leaflet 1.9.4)와 지도 그림(CARTO, 안 되면 OpenStreetMap)을 밖에서 받으면 약도 자리에 실제 지도가 뜬다. 못 받으면 약도가 그대로 남는다.

지도와 **목록**이 한 벌이다. 핀이 없는 장소도 목록만으로 읽혀야 한다.

## 본보기

아래 조각을 `index.html`의 `<body>` 안에 그대로 넣고 `PLACES`만 채운다. 핀이나 목록의 이름을 누르거나 이전 · 다음으로 장소를 옮긴다. 라이브러리의 주소와 `integrity` 값은 바꾸지 않는다 (값이 다르면 브라우저가 받은 것을 쓰지 않고 약도로 남는다).

```html
<style>
  .map, #map-places { --ink: #111; --paper: #fff; --line: #d6d6d6; --ground: #f5f5f5; --k: 1; }
  .map { margin: 16px 0; }
  .map-box { position: relative; overflow: hidden; isolation: isolate; border: 1px solid var(--line); border-radius: 8px;
    background: var(--ground); }
  .map-box .map-real { position: absolute; inset: 0; display: none; }
  .map.real .map-real { display: block; }
  .map.real .map-land, .map.real .map-zoom { display: none; }
  .map-land { position: absolute; inset: 0; transform-origin: 0 0; transition: transform .4s ease;
    background-image: linear-gradient(var(--line) calc(1px / var(--k)), transparent 0),
      linear-gradient(90deg, var(--line) calc(1px / var(--k)), transparent 0); }
  .map-land svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .map-route { fill: none; stroke: var(--ink); stroke-opacity: .5; stroke-linecap: round; stroke-linejoin: round;
    stroke-dasharray: 1; stroke-dashoffset: 1; animation: map-draw 1.4s .2s ease forwards; }
  @keyframes map-draw { to { stroke-dashoffset: 0; } }
  .map-pin { position: absolute; display: grid; place-items: center; width: 28px; height: 28px; padding: 0;
    border: 2px solid var(--paper); border-radius: 50%; background: var(--ink); color: var(--paper);
    font: 600 13px system-ui, sans-serif; cursor: pointer; box-shadow: 0 1px 4px rgba(0, 0, 0, .35);
    transform: translate(-50%, -50%) scale(calc(var(--up, 1) / var(--k))); transition: transform .4s ease; }
  .map-pin:hover, .map-pin:focus-visible { --up: 1.15; z-index: 2; }
  .map-pin.on { --up: 1.3; z-index: 3; border-color: var(--ink); background: var(--paper); color: var(--ink); }
  .map-pin.flat { position: relative; transform: scale(var(--up, 1)); }
  .map-pin[data-name]::after { content: attr(data-name); position: absolute; left: 50%; bottom: calc(100% + 6px);
    transform: translateX(-50%); max-width: 11em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    padding: 2px 8px; border: 1px solid var(--ink); border-radius: 6px; background: var(--paper); color: var(--ink);
    font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .15s; }
  .map-pin.l::after { left: 0; transform: none; }
  .map-pin.r::after { left: auto; right: 0; transform: none; }
  .map-pin.b::after { bottom: auto; top: calc(100% + 6px); }
  .map-pin:hover::after, .map-pin:focus-visible::after, .map-pin.on::after { opacity: 1; }
  .map-zoom { position: absolute; right: 8px; top: 8px; display: grid; gap: 4px; }
  .map-zoom button, .map-bar button { padding: 6px 12px; border: 1px solid var(--ink); border-radius: 6px;
    background: var(--paper); color: var(--ink); font: inherit; cursor: pointer; }
  .map-zoom button:disabled, .map-bar button:disabled { opacity: .35; cursor: default; }
  .map-bar { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; margin: 10px 0 4px; }
  .map-bar p { margin: 0; text-align: center; }
  .map small, #map-places small { color: #666; }
  #map-places { margin: 16px 0; padding: 0; list-style: none; }
  #map-places li { display: grid; grid-template-columns: 28px 1fr; gap: 4px 10px; padding: 12px 8px;
    border-bottom: 1px solid #eee; border-radius: 6px; }
  #map-places li.on { background: var(--ground); }
  #map-places .no { --up: 1; grid-row: span 3; cursor: default; }
  #map-places button { all: unset; cursor: pointer; font-weight: 600; }
  #map-places a { margin-right: 10px; }
  @media (prefers-reduced-motion: reduce) {
    .map-land, .map-pin { transition: none; }
    .map-route { animation: none; stroke-dashoffset: 0; }
  }
</style>
<section class="map" id="map" aria-label="지도">
  <div class="map-box">
    <div class="map-real"></div>
    <div class="map-land"><svg aria-hidden="true" preserveAspectRatio="none"><polyline class="map-route" pathLength="1" /></svg></div>
    <div class="map-zoom">
      <button type="button" id="map-in" aria-label="크게">＋</button>
      <button type="button" id="map-out" aria-label="작게">－</button>
    </div>
  </div>
  <div class="map-bar">
    <button type="button" id="map-prev">이전</button>
    <p id="map-now" aria-live="polite"></p>
    <button type="button" id="map-next">다음</button>
  </div>
  <small id="map-note"></small>
</section>
<ol id="map-places"></ol>
<script>
  // 장소를 도는 순서대로. lat · lng은 확실한 값만 적고, 아니면 null (핀 없이 목록에만 나온다)
  const PLACES = [
    { name: '서울숲', address: '서울 성동구 뚝섬로 273', lat: 37.5444, lng: 127.0374, note: '14:00 · 산책' },
    { name: '성수동 카페거리', address: '서울 성동구 성수동2가', lat: null, lng: null, note: '15:30 · 위치 확인 필요' },
  ];
  // 순서대로 선으로 잇는다 (코스 · 동선). 순서가 없는 목록(맛집 모음)이면 false
  const ROUTE = true;

  // 실제 지도: 라이브러리와 그림을 밖에서 받는다. 격리된 페이지는 어디서 왔는지(Referer)를 보내지 않아, 그것 없이 주는 곳을 앞에 둔다.
  // 앞이 안 되면 다음으로 넘어가고, 다 안 되면 약도로 돌아간다. 저작권 표시는 사용 조건이라 지우지 않는다
  const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
  const LEAFLET_CSS = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
  const LEAFLET_JS = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  const TILES = [
    { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', subdomains: 'abcd', maxZoom: 20,
      attribution: `${OSM} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>` },
    { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM },
  ];

  const W = 4, H = 3, PAD = 0.16; // 지도 상자의 가로 : 세로, 약도의 가장자리 여백
  const DEG = 111320; // 위도 1도의 길이 (m)
  const ZOOMS = [1, 2, 4];
  const root = document.getElementById('map');
  const box = root.querySelector('.map-box');
  const land = root.querySelector('.map-land');
  const line = root.querySelector('.map-route');
  const pinned = PLACES.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  const pins = new Map(); // 약도의 핀
  const marks = new Map(); // 실제 지도의 핀
  const rows = [];
  let leaf = null; // 실제 지도 (없으면 약도)
  let cell = 0;
  let zoom = 0;
  let now = 0;

  // 위도 · 경도 → 상자 안의 자리(0~100). 가로세로 비를 지켜 실제 배치와 닮게 놓는다
  const mid = (values) => (Math.min(...values) + Math.max(...values)) / 2;
  const midLat = mid(pinned.map((p) => p.lat));
  const midLng = mid(pinned.map((p) => p.lng));
  const east = (p) => (p.lng - midLng) * Math.cos((midLat * Math.PI) / 180);
  const north = (p) => p.lat - midLat;
  // 상자의 한 단위가 몇 도인가. 장소가 하나거나 한곳에 몰려도 상자의 가로가 1km 아래로 줄지 않는다
  const unit = Math.max(1000 / DEG / W,
    ...pinned.map((p) => Math.max(Math.abs(east(p)) / W, Math.abs(north(p)) / H) / (0.5 - PAD)));
  const spot = (p) => [50 + (east(p) / unit / W) * 100, 50 - (north(p) / unit / H) * 100];
  const gap = (a, b) => Math.hypot(east(a) - east(b), north(a) - north(b)) * DEG;
  const far = (m) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)}m` : `${Number((m / 1000).toFixed(m < 10000 ? 1 : 0))}km`);

  function view() {
    const k = ZOOMS[zoom];
    const at = k > 1 && pins.has(PLACES[now]) ? spot(PLACES[now]) : [50, 50];
    const shift = (c) => Math.min(0, Math.max((1 - k) * 100, 50 - c * k));
    root.style.setProperty('--k', k);
    land.style.transform = `translate(${shift(at[0])}%, ${shift(at[1])}%) scale(${k})`;
    line.setAttribute('stroke-width', (3 * W * 100) / (box.clientWidth || 400) / k);
    document.getElementById('map-in').disabled = zoom === ZOOMS.length - 1;
    document.getElementById('map-out').disabled = zoom === 0;
    document.getElementById('map-note').textContent = [
      `${leaf ? '지도' : '약도'} · 핀의 위치는 대략${ROUTE ? ', 선은 도는 순서' : ''}`,
      leaf ? null : `눈금 한 칸 약 ${far(cell)} · 위쪽이 북`,
    ].filter(Boolean).join(' · ');
  }

  function select(i, show) {
    now = Math.min(PLACES.length - 1, Math.max(0, i));
    const p = PLACES[now];
    const next = PLACES[now + 1];
    PLACES.forEach((q, n) => {
      pins.get(q)?.classList.toggle('on', n === now);
      pins.get(q)?.setAttribute('aria-pressed', String(n === now));
      rows[n].classList.toggle('on', n === now);
      marks.get(q)?.face.classList.toggle('on', n === now);
      marks.get(q)?.marker.setZIndexOffset(n === now ? 1000 : 0);
    });
    if (leaf && marks.has(p)) leaf.panInside(marks.get(p).marker.getLatLng(), { padding: [48, 48] });
    document.getElementById('map-now').textContent = [
      `${now + 1} / ${PLACES.length}`,
      p.name,
      pins.has(p) ? null : '핀 없음',
      ROUTE && pins.has(p) && pins.has(next) ? `다음까지 직선 약 ${far(gap(p, next))}` : null,
    ].filter(Boolean).join(' · ');
    document.getElementById('map-prev').disabled = now === 0;
    document.getElementById('map-next').disabled = now === PLACES.length - 1;
    view();
    if (show) root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 실제 지도를 걷어 내고 약도로 돌아간다
  function back() {
    leaf?.remove();
    leaf = null;
    marks.clear();
    root.classList.remove('real');
    select(now);
  }

  // 약도 위에 실제 지도를 올린다. 지도 그림을 끝내 못 받으면 약도로 돌아간다
  function real() {
    const L = window.L;
    const points = pinned.map((p) => [p.lat, p.lng]);
    const draw = (n) => {
      if (n === TILES.length) return setTimeout(back);
      const { url, ...options } = TILES[n];
      const layer = L.tileLayer(url, options).addTo(leaf);
      layer.once('tileerror', () => {
        if (!leaf?.hasLayer(layer)) return;
        leaf.removeLayer(layer);
        draw(n + 1);
      });
    };
    root.classList.add('real');
    leaf = L.map(root.querySelector('.map-real'), { scrollWheelZoom: false });
    leaf.fitBounds(points, { padding: [48, 48], maxZoom: 16 });
    draw(0);
    PLACES.forEach((p, i) => {
      if (!pins.has(p)) return;
      const face = document.createElement('span');
      face.className = 'map-pin flat';
      face.textContent = String(i + 1);
      face.dataset.name = p.name;
      const icon = L.divIcon({ className: '', html: face, iconSize: [28, 28], iconAnchor: [14, 14] });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(leaf).on('click', () => select(i));
      marker.getElement().setAttribute('aria-label', `${i + 1}. ${p.name}`);
      marks.set(p, { marker, face });
    });
    const ink = getComputedStyle(root).getPropertyValue('--ink').trim() || '#111';
    if (ROUTE && points.length > 1) L.polyline(points, { color: ink, weight: 3, opacity: 0.5 }).addTo(leaf);
    select(now);
  }

  PLACES.forEach((p, i) => {
    const li = document.createElement('li');
    const no = document.createElement('span');
    no.className = 'map-pin flat no';
    no.textContent = String(i + 1);
    const name = document.createElement('button');
    name.type = 'button';
    name.textContent = p.name;
    name.addEventListener('click', () => select(i, true));
    const detail = document.createElement('small');
    detail.textContent = [p.note, p.address, pinned.includes(p) ? null : '핀 없음'].filter(Boolean).join(' · ');
    const links = document.createElement('small');
    for (const [label, url] of [
      ['카카오맵', `https://map.kakao.com/link/search/${encodeURIComponent(p.name)}`],
      ['네이버 지도', `https://map.naver.com/p/search/${encodeURIComponent(p.name)}`],
    ]) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label;
      links.append(a);
    }
    li.append(no, name, detail, links);
    document.getElementById('map-places').append(li);
    rows.push(li);
  });

  if (pinned.length === 0) root.hidden = true;
  else {
    const across = W * unit * DEG; // 상자의 가로가 실제로 몇 m인가
    const steps = [1, 2, 5].flatMap((n) => [10, 100, 1000, 10000, 100000, 1000000].map((e) => n * e));
    cell = Math.max(...steps.filter((m) => m <= across / 5));
    box.style.aspectRatio = `${W} / ${H}`;
    land.style.backgroundSize = `${(cell / across) * 100}% ${((cell / across) * 100 * W) / H}%`;
    land.querySelector('svg').setAttribute('viewBox', `0 0 ${W * 100} ${H * 100}`);
    PLACES.forEach((p, i) => {
      if (!pinned.includes(p)) return;
      const [x, y] = spot(p);
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = `map-pin${x < 30 ? ' l' : x > 70 ? ' r' : ''}${y < 30 ? ' b' : ''}`;
      pin.textContent = String(i + 1);
      pin.dataset.name = p.name;
      pin.setAttribute('aria-label', `${i + 1}. ${p.name}`);
      pin.style.left = `${x}%`;
      pin.style.top = `${y}%`;
      pin.addEventListener('click', () => select(i));
      land.append(pin);
      pins.set(p, pin);
    });
    if (ROUTE) line.setAttribute('points', pinned.map((p) => spot(p).map((c, n) => c * (n ? H : W)).join(',')).join(' '));
    const step = (by) => {
      zoom = Math.min(ZOOMS.length - 1, Math.max(0, zoom + by));
      view();
    };
    document.getElementById('map-in').addEventListener('click', () => step(1));
    document.getElementById('map-out').addEventListener('click', () => step(-1));
    document.getElementById('map-prev').addEventListener('click', () => select(now - 1));
    document.getElementById('map-next').addEventListener('click', () => select(now + 1));
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.target.closest('.map-real')) return; // 실제 지도 안에서는 화살표가 지도를 민다
      event.preventDefault();
      select(now + (event.key === 'ArrowRight' ? 1 : -1));
    });
    addEventListener('resize', view);
    select(0);
    // 약도와 목록을 먼저 그리고, 실제 지도는 받아지면 올린다 (받는 동안 페이지가 멈추지 않는다)
    const load = (tag, attrs) => new Promise((done, fail) => {
      const el = Object.assign(document.createElement(tag), { crossOrigin: '', onload: done, onerror: fail }, attrs);
      document.head.append(el);
    });
    Promise.all([
      load('link', { rel: 'stylesheet', integrity: LEAFLET_CSS, href: `${LEAFLET}.css` }),
      load('script', { integrity: LEAFLET_JS, src: `${LEAFLET}.js` }),
    ]).then(real).catch(back);
  }
</script>
```

## 장소와 좌표

- 이름은 지도 앱에서 찾으면 그곳이 나오는 정식 이름으로 적는다 (지점이 여럿이면 지점까지). 목록의 지도 링크는 이 이름으로 찾는다.
- 주소는 웹 검색으로 확인한 것만 적는다. 확인한 곳의 주소(출처)는 페이지 아래에 모아 적는다.
- **좌표(lat · lng)는 확실한 것만 적는다.** 검색 결과에 나온 좌표, 잘 알려진 곳, 확인한 주소로 위치를 아는 곳. 실제 지도 위에 찍히므로 수백 m만 어긋나도 틀려 보인다. 어디쯤인지 짐작만 되면 `null`로 둔다 (핀 없이 목록과 지도 링크로 찾을 수 있다).
- 좌표는 소수점 넷째 자리까지 (약 10m). 한국은 위도 33~39, 경도 124~132 안이다. 벗어나면 위도와 경도가 바뀌었는지 본다.
- 사람의 집 · 개인 주소는 넣지 않는다.

## 고칠 수 있는 것, 없는 것

- 고쳐도 되는 것: `PLACES`, `ROUTE`, 색(맨 위의 `--ink` · `--paper` · `--line` · `--ground`) · 크기 같은 스타일, 목록에 보일 글. 지도 위 · 아래에 요약, 시간표, 비용, 출처를 더한다.
- 그대로 두는 것: 라이브러리의 주소와 `integrity`, 지도 그림을 주는 곳(`TILES`)과 그 순서, 저작권 표시(`attribution`, OpenStreetMap · CARTO의 사용 조건이다), 약도로 돌아가는 부분(`back`), 자리를 계산하는 부분(`spot` · `unit`), 지도 아래의 안내 글("핀의 위치는 대략"), 목록.
- 장소 이름 · 주소 · 메모는 `textContent`로만 넣는다 (본보기가 그렇게 한다). 검색해서 얻은 글을 `innerHTML`로 넣지 않는다.
- 다른 지도 서비스의 스크립트(카카오 · 네이버 · 구글 지도 API)는 쓰지 않는다. 키와 등록한 주소가 있어야 하고, 격리된 페이지에서는 돌지 않는다.
- 약도에 길 · 강 · 건물을 짐작으로 그려 넣지 않는다: 확인하지 못한 지형은 틀린 지도다.

## 확인

- 좌표가 있는 장소 수와 핀 수가 같은지, 순서가 지시와 같은지 `PLACES`를 다시 읽는다.
- 이어진 두 장소의 직선 거리가 말이 되는지 본다 (본보기의 `gap`과 같은 계산을 `node -e`로). 같은 동네인데 몇 km가 나오면 좌표가 틀린 것이다.
- 칸에서는 밖의 지도를 받을 수 없어 실제 지도를 그려 볼 수 없다. `PLACES`의 따옴표 · 쉼표가 맞는지 `node -e`로 그 줄들만 돌려 확인한다 (문법 오류면 지도와 목록이 모두 비어 보인다).
- 답(마지막 메시지)에 좌표를 넣지 못한 장소를 적는다.
