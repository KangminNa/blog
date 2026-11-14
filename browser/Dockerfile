# Cairn 서버 브라우저: neko 이미지의 화면(Xorg + openbox)과 Chromium에 Cairn의 실행 옵션과 정책을 담는다.
# 화면은 콘솔의 브라우저 메뉴에서 HTTPS로 (서버가 조종 중계 9223에 붙는다), CDP는 같은 네트워크의 서버 러너에게만 (docker-compose.browser.yml)
# 기본 이미지는 amd64 · arm64가 함께 있는 neko 3.2.0 (digest 고정, 2026-11-14): ARM 서버에서도 그대로 빌드한다.
# neko 서버(실시간 영상 · 원격 입력 · 비밀번호)는 쓰지 않아 끈다 (2차 3단계): 영상 포트 · 비밀번호가 없다.
FROM ghcr.io/m1k1o/neko/chromium@sha256:270face8b8111e639744fb7bcdbbf0deed227900bb89d58b2f8adfc12af8c41e
COPY browser/chromium.conf /etc/neko/supervisord/chromium.conf
# 정책: CDP 허락(RemoteDebuggingAllowed · DeveloperToolsAvailability 1), 쿠키를 끈 뒤에도 유지(DefaultCookiesSetting 1:
# 이미지의 기본 프로필은 "세션에만 쿠키"라 끄면 로그인이 지워졌다), 내려받기 · 파일 열기 · 확장 프로그램 막기,
# 이 서버 · compose 서비스 · 메타데이터 이름 막기(URLBlocklist: IP 대역은 적을 수 없어 둘러보기는 러너의 프록시가 막는다),
# 프록시를 거치지 않는 WebRTC UDP 막기(둘러보기 창이 프록시를 비켜 가지 않게)
COPY browser/policies.json /etc/chromium/policies/managed/policies.json
# 조종 중계(2026-11-14): 서버가 콘솔 화면(그림 · 클릭 · 입력) · 세션 지우기를 위해 Chrome에 붙는 길. 127.0.0.1:9222 → 9223
# 이미지에 있는 python3만 쓴다 (빌드할 때 내려받을 것이 없다). supervisord가 띄운다 (cdp-relay.conf)
COPY browser/cdp-relay.py /usr/local/lib/cairn/cdp-relay.py
COPY browser/cdp-relay.conf /etc/neko/supervisord/cdp-relay.conf
# neko 서버를 끈다: supervisord의 [program:neko]에 autostart=false (있던 autostart는 지우고). 찾지 못하면 빌드를 멈춘다
RUN files="$(grep -rl '^\[program:neko\]' /etc/neko)" && test -n "$files" \
  && sed -i -e '/^\[program:neko\]$/,/^\[/{/^autostart=/d}' -e '/^\[program:neko\]$/a autostart=false' $files \
  && grep -h -A1 '^\[program:neko\]' $files | grep -q '^autostart=false'
# 화면 크기: neko 서버가 정하던 1280×720을 Chromium 창으로 정한다 (--window-size, chromium.conf).
# X 화면은 1920×1080이라 openbox가 창을 최대화하지 않게 한다 (없는 판이면 그대로 두고 최대화된 채로 돈다)
RUN sed -i 's#<maximized>true</maximized>#<maximized>false</maximized>#' /etc/neko/openbox.xml
