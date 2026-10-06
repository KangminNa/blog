# Cairn 앱 이미지 (모노레포 공통). 개발 단계에서는 dev 스테이지를 쓴다.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# 의존성: 매니페스트만 먼저 복사해 캐시를 살린다
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# 개발: 소스 전체 + 감시 모드 실행 (compose에서 src를 마운트해 바로 반영)
FROM deps AS dev
COPY . .
