# Cairn 앱 이미지 (모노레포 공통).
#   dev     개발. 소스 전체 + 감시 모드 (docker-compose.yml)
#   server  운영 서버·일꾼. 컴파일한 JS만 (docker-compose.prod.yml)
#   web     운영 웹. next build의 standalone 결과만 (docker-compose.prod.yml)
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
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

# 개발: 소스 전체 + 감시 모드 실행 (compose에서 src를 마운트해 바로 반영)
# cairn-admin: 서버 명령줄 (pnpm plugin · install-code · owner · secret:rotate가 개발·운영 모두 이 이름으로 부른다)
FROM deps AS dev
COPY . .
RUN printf '#!/bin/sh\nexec pnpm --silent --filter @cairn/server cli "$@"\n' > /usr/local/bin/cairn-admin \
    && chmod +x /usr/local/bin/cairn-admin

# 운영 서버 빌드: 서버와 플러그인 서버 코드를 tsc로 컴파일하고, 실행에 필요한 패키지만 모은다
FROM deps AS server-build
COPY apps/server apps/server
COPY plugins plugins
RUN pnpm --filter @cairn/server build \
    && pnpm --filter @cairn/server --prod deploy --legacy /deploy

# 운영 서버·일꾼: 저장소와 같은 모양으로 둔다 (/app/apps/server · /app/plugins · /app/skills).
# 플러그인은 목록 파일이 가리키는 .ts 옆에 컴파일한 .js를 얹는다. 실행 중에 TS를 읽지 않는다
FROM node:24-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app/apps/server
COPY --from=server-build /deploy/node_modules /app/node_modules
COPY plugins /app/plugins
COPY skills /app/skills
COPY --from=server-build /repo/apps/server/dist /app
RUN printf '#!/bin/sh\nexec node /app/apps/server/src/main.cli.js "$@"\n' > /usr/local/bin/cairn-admin \
    && chmod +x /usr/local/bin/cairn-admin
USER node
CMD ["node", "src/main.api.js"]

# 운영 웹 빌드. rewrites는 빌드할 때 결과에 박히므로 서버 주소(compose의 별명)를 여기서 준다
FROM deps AS web-build
ENV API_URL=http://cairn-server:4000
COPY apps/web apps/web
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
