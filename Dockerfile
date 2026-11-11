# Cairn 앱 이미지 (모노레포 공통).
#   dev     개발. 소스 전체 + 감시 모드 (docker-compose.yml)
#   server  운영 서버·일꾼. 컴파일한 JS만 (docker-compose.prod.yml)
#   web     운영 웹. next build의 standalone 결과만 (docker-compose.prod.yml)
#   runner  운영 서버 러너. 컴파일한 러너와 AI CLI(Claude · Codex). docker-compose.prod.yml에 함께 뜬다
#   egress  코드 러너 칸의 나가는 프록시. 허용 목록의 호스트로만 HTTPS 터널을 연다 (docker-compose.code.yml)
#   code-runner  코드 러너 칸. 운영 러너 + git · 빌드 도구 (docker-compose.code.yml)
# 운영 이미지는 root가 아닌 node 사용자로 돌고, 코드는 root 소유라 실행 중에 고칠 수 없다.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# 의존성: 매니페스트만 먼저 복사해 캐시를 살린다 (lock 파일이 바뀔 때만 다시 받는다).
# BuildKit 전용 문법(RUN --mount 등)은 쓰지 않는다: 예전 빌더만 있는 서버에서도 빌드되게
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/runner/package.json apps/runner/
COPY apps/egress/package.json apps/egress/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

# 개발: 소스 전체 + 감시 모드 실행 (compose에서 src를 마운트해 바로 반영)
# cairn-admin: 서버 명령줄 (pnpm plugin · install-code · owner · secret:rotate가 개발·운영 모두 이 이름으로 부른다)
# /data/blobs: 사진 볼륨 자리. 빈 볼륨은 이미지의 폴더 소유자를 물려받는다.
# 개발 compose로 만든 볼륨을 운영 compose가 이어 써도 node 사용자가 쓸 수 있게 여기서도 node로 둔다
FROM deps AS dev
COPY . .
RUN printf '#!/bin/sh\nexec pnpm --silent --filter @cairn/server cli "$@"\n' > /usr/local/bin/cairn-admin \
    && chmod +x /usr/local/bin/cairn-admin \
    && mkdir -p /data/blobs && chown node:node /data/blobs

# 운영 서버 빌드: 서버와 플러그인 서버 코드를 tsc로 컴파일하고, 실행에 필요한 패키지만 모은다
FROM deps AS server-build
COPY apps/server apps/server
COPY plugins plugins
RUN pnpm --filter @cairn/server build \
    && pnpm --filter @cairn/server --prod deploy --legacy /deploy

# 운영 서버·일꾼: 저장소와 같은 모양으로 둔다 (/app/apps/server · /app/plugins · /app/skills).
# 플러그인은 목록 파일이 가리키는 .ts 옆에 컴파일한 .js를 얹는다. 실행 중에 TS를 읽지 않는다
# 코드는 root 소유로 두고, 쓸 수 있는 곳은 사진 볼륨(/data/blobs)과 러너 연결 값 볼륨뿐이다.
# 코드 러너 칸의 연결 값 폴더(/run/cairn-code)는 node와 node 그룹만 연다: 칸의 러너는 그 그룹에 들고, 칸 안의 AI(agent)는 읽지 못한다
FROM node:24-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app/apps/server
COPY --from=server-build /deploy/node_modules /app/node_modules
COPY plugins /app/plugins
COPY skills /app/skills
COPY --from=server-build /repo/apps/server/dist /app
RUN printf '#!/bin/sh\nexec node /app/apps/server/src/main.cli.js "$@"\n' > /usr/local/bin/cairn-admin \
    && chmod +x /usr/local/bin/cairn-admin \
    && mkdir -p /data/blobs /run/cairn-runner /run/cairn-code \
    && chown node:node /data/blobs /run/cairn-runner /run/cairn-code \
    && chmod 750 /run/cairn-code
USER node
CMD ["node", "src/main.api.js"]

# 운영 웹 빌드. rewrites는 빌드할 때 결과에 박히므로 서버 주소(compose의 별명)를 여기서 준다
# 서버 소스는 next build의 타입 검사가 *.view.ts를 읽으라고 넣는다 (import type이라 결과에는 들어가지 않는다)
FROM deps AS web-build
ENV API_URL=http://cairn-server:4000
COPY apps/web apps/web
COPY apps/server/src apps/server/src
COPY plugins plugins
COPY scripts/sync-plugins.mjs scripts/
RUN pnpm --filter @cairn/web build

# 운영 웹: standalone 결과와 정적 파일만. .next/cache는 next가 실행 중에 쓴다
FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=web-build /repo/apps/web/.next/standalone ./
COPY --from=web-build /repo/apps/web/.next/static apps/web/.next/static
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
CMD ["node", "apps/web/server.js"]

# 운영 러너 빌드: src만 복사한다. 러너 폴더의 .env에는 주인 컴퓨터의 토큰이 있을 수 있다
FROM deps AS runner-build
COPY apps/runner/src apps/runner/src
COPY apps/runner/tsconfig.json apps/runner/tsconfig.build.json apps/runner/
RUN pnpm --filter @cairn/runner build

# 운영 러너: 러너는 런타임 의존 패키지가 없어 컴파일한 JS만 둔다. 저장소와 같은 모양이라 스킬은 /app/skills에서 찾는다.
# AI CLI(Claude, Codex)는 이 이미지에만 넣고 정확한 버전으로 고정한다 (package.json에 넣지 않는다: 서버와 웹에 딸려 가면 안 된다).
# Codex는 웹 로그인(codex login --device-auth)과 Codex 에이전트의 일(codex exec, 셸 없이)에 쓴다. 로그인 명령의 PTY는 기본으로 든 script(util-linux)로 만든다.
# 비밀값은 이미지와 홈에 두지 않는다. 기기 토큰은 환경 변수, AI 토큰은 일마다 서버에서 받아 메모리에만 둔다
FROM node:24-bookworm-slim AS runner
# 러너의 빌드 (지시문 틀의 판). 실행 기록에 남는다: --build-arg CAIRN_RUNNER_BUILD=$(git rev-parse --short HEAD)
ARG CAIRN_RUNNER_BUILD=unknown
ENV NODE_ENV=production \
    CAIRN_RUNNER_BUILD=$CAIRN_RUNNER_BUILD
WORKDIR /app/apps/runner
RUN npm install -g @anthropic-ai/claude-code@2.1.302 @openai/codex@0.164.0
COPY skills /app/skills
COPY --from=runner-build /repo/apps/runner/dist /app/apps/runner/src
USER node
CMD ["node", "src/main.js"]

# 코드 러너 칸 (docs/코드작업.md): 운영 러너에 저장소 작업 도구(git, 네이티브 모듈을 빌드할 make · g++ · python3)를 더한다.
# 만들기 작업(결과물 2차)의 도구도 여기에: LibreOffice(PPT · 문서를 PDF로, 미리 보기), poppler(PDF → PNG), ffmpeg(영상),
# 한국어 글꼴(Noto CJK), 문서 · 도표 라이브러리(/opt/make, 버전은 apps/runner/make-tools.txt). 칸 안에서는 설치하지 않는다.
# 칸에서는 AI가 셸을 쓰므로 AI · setup · checks는 다른 사용자 agent(1001)로 돈다: 러너의 메모리 · 환경 · 연결 값과 토큰을 읽지 못하게.
# 사용자를 바꾸려면 러너가 root여야 한다. compose가 권한을 CHOWN · SETUID · SETGID · KILL만 남긴다 (DAC_OVERRIDE 없음).
# CAIRN_SANDBOX=1은 이 이미지에만 있다. 러너는 이 값이 있을 때만 칸 번호(CAIRN_RUNNER_SLOT)를 받는다.
# /work는 작업 자리 (compose가 칸마다 볼륨을 붙인다). /run/cairn-code는 연결 값 볼륨이 붙는 곳 (node 그룹만)
FROM runner AS code-runner
USER root
COPY apps/runner/make-tools.txt /opt/make-tools.txt
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates make g++ python3 python3-venv \
      ffmpeg poppler-utils fonts-noto-cjk \
      libreoffice-impress libreoffice-writer libreoffice-calc \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/make \
 && /opt/make/bin/pip install --no-cache-dir -r /opt/make-tools.txt \
 && useradd --uid 1001 --user-group --no-create-home --shell /usr/sbin/nologin agent \
 && mkdir -p /run/cairn-code /work && chown node:node /run/cairn-code && chmod 750 /run/cairn-code
ENV CAIRN_SANDBOX=1 \
    CAIRN_AGENT_USER=1001:1001 \
    PATH=/opt/make/bin:$PATH
USER root
CMD ["node", "src/main.js"]

# 나가는 프록시 빌드
FROM deps AS egress-build
COPY apps/egress/src apps/egress/src
COPY apps/egress/tsconfig.json apps/egress/tsconfig.build.json apps/egress/
RUN pnpm --filter @cairn/egress build

# 나가는 프록시: 런타임 의존 패키지가 없어 컴파일한 JS만 둔다. 허용 목록은 compose가 읽기 전용으로 붙인다 (egress/allow.txt)
FROM node:24-bookworm-slim AS egress
ENV NODE_ENV=production
WORKDIR /app
COPY --from=egress-build /repo/apps/egress/dist /app
USER node
EXPOSE 3128
CMD ["node", "main.js"]
