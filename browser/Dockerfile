# Cairn 서버 브라우저: neko(Chromium + 실시간 화면)에 Cairn의 실행 옵션과 정책을 담는다 (2026-11-08 시험으로 확인한 값).
# 화면은 콘솔의 브라우저 메뉴(/browser/, Caddy가 주인만 넘김)로, CDP는 같은 네트워크의 서버 러너에게만 (docker-compose.browser.yml)
# 기본은 시험한 이미지(amd64만 있다). ARM 컴퓨터는 .env의 CAIRN_NEKO_IMAGE로 다른 판을 고른다 (.env.example)
ARG CAIRN_NEKO_IMAGE=m1k1o/neko:chromium@sha256:6b979c31d5e5aa22fd7dac9d58b280ba9bce2542689573be4d7decbec9af0d79
FROM ${CAIRN_NEKO_IMAGE}
COPY browser/chromium.conf /etc/neko/supervisord/chromium.conf
# 정책: CDP 허락(RemoteDebuggingAllowed · DeveloperToolsAvailability 1), 쿠키를 끈 뒤에도 유지(DefaultCookiesSetting 1:
# 이미지의 기본 프로필은 "세션에만 쿠키"라 끄면 로그인이 지워졌다), 내려받기 · 파일 열기 · 확장 프로그램 막기
COPY browser/policies.json /etc/chromium/policies/managed/policies.json
# 조종 중계(2026-11-14): 서버가 콘솔 화면(그림 · 클릭 · 입력)을 위해 Chrome에 붙는 길. 127.0.0.1:9222 → 9223
# 이미지에 있는 python3만 쓴다 (빌드할 때 내려받을 것이 없다). supervisord가 띄운다 (cdp-relay.conf)
COPY browser/cdp-relay.py /usr/local/lib/cairn/cdp-relay.py
COPY browser/cdp-relay.conf /etc/neko/supervisord/cdp-relay.conf
