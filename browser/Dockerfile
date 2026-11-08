# Cairn 서버 브라우저: neko(Chromium + 실시간 화면)에 Cairn의 실행 옵션과 정책을 담는다 (2026-11-08 시험으로 확인한 값).
# 화면은 콘솔의 브라우저 메뉴(/browser/, Caddy가 주인만 넘김)로, CDP는 같은 네트워크의 서버 러너에게만 (docker-compose.browser.yml)
FROM m1k1o/neko:chromium@sha256:6b979c31d5e5aa22fd7dac9d58b280ba9bce2542689573be4d7decbec9af0d79
COPY browser/chromium.conf /etc/neko/supervisord/chromium.conf
# 정책: CDP 허락(RemoteDebuggingAllowed · DeveloperToolsAvailability 1), 쿠키를 끈 뒤에도 유지(DefaultCookiesSetting 1:
# 이미지의 기본 프로필은 "세션에만 쿠키"라 끄면 로그인이 지워졌다), 내려받기 · 파일 열기 · 확장 프로그램 막기
COPY browser/policies.json /etc/chromium/policies/managed/policies.json
