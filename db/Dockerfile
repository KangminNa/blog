# Cairn DB 이미지: Postgres 17 + pgvector(의미 검색) + pg_bigm(한국어 키워드 검색)
FROM pgvector/pgvector:pg17

ARG PG_MAJOR=17
ARG PG_BIGM_VERSION=1.2-20250903

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends build-essential ca-certificates curl "postgresql-server-dev-${PG_MAJOR}"; \
    curl -fsSL "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" -o /tmp/pg_bigm.tar.gz; \
    mkdir -p /tmp/pg_bigm; \
    tar -xzf /tmp/pg_bigm.tar.gz -C /tmp/pg_bigm --strip-components=1; \
    make -C /tmp/pg_bigm USE_PGXS=1; \
    make -C /tmp/pg_bigm USE_PGXS=1 install; \
    rm -rf /tmp/pg_bigm /tmp/pg_bigm.tar.gz; \
    apt-get purge -y --auto-remove build-essential curl "postgresql-server-dev-${PG_MAJOR}"; \
    rm -rf /var/lib/apt/lists/*
