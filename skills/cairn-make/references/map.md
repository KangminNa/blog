# 지도로 답하기 (페이지)

장소가 둘 이상 나오는 답(코스 · 맛집 · 여행 · 동선)이나 지시가 지도를 말하면 페이지에 지도를 넣는다. 지도는 [page.md](page.md)의 규칙 위에 얹는다.

지도는 **핀 + 목록**이 한 벌이다. 지도가 뜨지 않아도 목록만으로 답이 읽혀야 한다.

## 본보기

아래 조각을 `index.html`의 `<body>` 안에 그대로 넣고 `PLACES`만 채운다. 지도 라이브러리(Leaflet 1.9.4)와 지도 그림(CARTO, 안 되면 OpenStreetMap)은 보는 사람의 브라우저가 밖에서 받는다. 주소와 `integrity` 값은 바꾸지 않는다 (값이 다르면 브라우저가 스크립트를 돌리지 않는다).

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<style>
  #map { height: 56vh; min-height: 280px; border: 1px solid #ddd; border-radius: 8px; }
  #map-off { padding: 12px; border: 1px solid #ddd; border-radius: 8px; color: #555; }
  .pin { display: grid; place-items: center; width: 28px; height: 28px; border: 2px solid #fff;
    border-radius: 50%; background: #111; color: #fff; font: 600 13px system-ui, sans-serif;
    box-shadow: 0 1px 4px rgba(0, 0, 0, .4); }
  #places { margin: 16px 0; padding: 0; list-style: none; }
  #places li { display: grid; grid-template-columns: 28px 1fr; gap: 4px 10px; padding: 12px 0;
    border-bottom: 1px solid #eee; }
  #places .no { grid-row: span 3; }
  #places button { all: unset; cursor: pointer; font-weight: 600; }
  #places small { color: #666; }
  #places a { margin-right: 10px; }
</style>
<div id="map" role="region" aria-label="지도"></div>
<p id="map-off" hidden>지도를 불러오지 못했어요. 아래 목록의 링크로 위치를 볼 수 있어요.</p>
<p id="map-plain" hidden><small>지도 그림을 받지 못해 핀만 보여요. 아래 목록의 링크로 위치를 볼 수 있어요.</small></p>
<ol id="places"></ol>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
  // 장소를 도는 순서대로. lat · lng은 확인한 값만 적고, 모르면 null (핀 없이 목록에만 나온다)
  const PLACES = [
    { name: '서울숲', address: '서울 성동구 뚝섬로 273', lat: 37.5444, lng: 127.0374, note: '14:00 · 산책' },
    { name: '성수동 카페거리', address: '서울 성동구 성수동2가', lat: null, lng: null, note: '15:30 · 위치 확인 필요' },
  ];
  // 순서대로 선으로 잇는다 (코스 · 동선). 순서가 없는 목록(맛집 모음)이면 false
  const ROUTE = true;

  // 지도 그림을 주는 곳. 격리된 페이지는 어디서 왔는지(Referer)를 보내지 않아, 그것 없이 주는 곳을 앞에 둔다.
  // 앞이 안 되면 다음으로 넘어가고, 다 안 되면 핀만 남긴다. 저작권 표시는 사용 조건이라 지우지 않는다
  const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  const TILES = [
    { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', subdomains: 'abcd', maxZoom: 20,
      attribution: `${OSM} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>` },
    { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM },
  ];

  const pinned = PLACES.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  const markers = new Map();
  let map = null;
  if (window.L && pinned.length > 0) {
    map = L.map('map', { scrollWheelZoom: false });
    const draw = (n) => {
      const { url, ...options } = TILES[n];
      const layer = L.tileLayer(url, options).addTo(map);
      layer.once('tileerror', () => {
        map.removeLayer(layer);
        if (n + 1 < TILES.length) draw(n + 1);
        else document.getElementById('map-plain').hidden = false;
      });
    };
    draw(0);
    PLACES.forEach((p, i) => {
      if (!pinned.includes(p)) return;
      const icon = L.divIcon({ className: '', html: `<span class="pin">${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const marker = L.marker([p.lat, p.lng], { icon, title: p.name }).addTo(map);
      const label = document.createElement('b');
      label.textContent = `${i + 1}. ${p.name}`;
      marker.bindPopup(label);
      markers.set(p, marker);
    });
    const points = pinned.map((p) => [p.lat, p.lng]);
    if (ROUTE && points.length > 1) L.polyline(points, { color: '#111', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(map);
    map.fitBounds(points, { padding: [32, 32], maxZoom: 16 });
  } else {
    document.getElementById('map').hidden = true;
    document.getElementById('map-off').hidden = false;
  }

  const list = document.getElementById('places');
  PLACES.forEach((p, i) => {
    const li = document.createElement('li');
    const no = document.createElement('span');
    no.className = 'pin no';
    no.textContent = String(i + 1);
    const name = document.createElement('button');
    name.type = 'button';
    name.textContent = p.name;
    name.addEventListener('click', () => {
      const marker = markers.get(p);
      if (!map || !marker) return;
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
      marker.openPopup();
      document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const detail = document.createElement('small');
    detail.textContent = [p.note, p.address, markers.has(p) ? null : '지도에 핀 없음'].filter(Boolean).join(' · ');
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
    list.append(li);
  });
</script>
```

## 장소와 좌표

- 이름은 지도 앱에서 찾으면 그곳이 나오는 정식 이름으로 적는다 (지점이 여럿이면 지점까지). 목록의 지도 링크는 이 이름으로 찾는다.
- 주소는 웹 검색으로 확인한 것만 적는다. 확인한 곳의 주소(출처)는 페이지 아래에 모아 적는다.
- **좌표(lat · lng)는 확인한 값만 적는다.** 검색 결과에 좌표가 있거나 잘 알려진 곳이라 확실할 때만. 조금이라도 불확실하면 `null`로 둔다: 핀이 틀린 곳에 찍힌 지도는 지도가 없는 것보다 나쁘다. 좌표가 없는 곳도 목록과 지도 링크로 찾을 수 있다.
- 좌표는 소수점 넷째 자리까지 (약 10m). 한국은 위도 33~39, 경도 124~132 안이다. 벗어나면 위도와 경도가 바뀌었는지 본다.
- 사람의 집 · 개인 주소는 넣지 않는다.

## 고칠 수 있는 것, 없는 것

- 고쳐도 되는 것: `PLACES`, `ROUTE`, 색 · 크기 같은 스타일, 목록에 보일 글. 지도 위 · 아래에 요약, 시간표, 비용, 출처를 더한다.
- 그대로 두는 것: 라이브러리의 주소와 `integrity`, 지도 그림을 주는 곳(`TILES`)과 그 순서, 저작권 표시(`attribution`, OpenStreetMap · CARTO의 사용 조건이다), 지도가 없을 때 목록으로 넘어가는 부분.
- 장소 이름 · 주소 · 메모는 `textContent`로만 넣는다 (본보기가 그렇게 한다). 검색해서 얻은 글을 `innerHTML`로 넣지 않는다.
- 다른 지도 서비스의 스크립트(카카오 · 네이버 · 구글 지도 API)는 쓰지 않는다. 키와 등록한 주소가 있어야 하고, 격리된 페이지에서는 돌지 않는다.

## 확인

- 좌표가 있는 장소 수와 핀 수가 같은지, 순서가 지시와 같은지 `PLACES`를 다시 읽는다.
- 칸에서는 밖의 지도 그림을 받을 수 없어 지도를 그려 볼 수 없다. 대신 `PLACES`의 따옴표 · 쉼표가 맞는지(문법 오류면 지도와 목록이 모두 비어 보인다) `node -e`로 그 줄들만 돌려 확인한다.
- 답(마지막 메시지)에 좌표를 넣지 못한 장소를 적는다.
