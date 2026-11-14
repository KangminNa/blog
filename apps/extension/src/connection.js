// 블로그와의 연결: 연결하기(등록 → 승인 창 → 토큰), 토큰 쓰기 · 갱신, 연결 해제.
// 열쇠는 저장소(chrome.storage.local)의 connection 하나에 둔다. 콘텐츠 스크립트는 저장소를 읽지 못한다 (background.js).
// 토큰은 어디에도 찍지 않고, 오류 문구에도 넣지 않는다.
//
//   connection = { site, mcp, tokenEndpoint, revokeEndpoint, clientId, accessToken, refreshToken, expiresAt, scope }
//                갱신 토큰이 죽으면(재사용 감지 · 끊김) 토큰을 지우고 { site, mcp, lost: true }만 남긴다 → "다시 연결"
import { authorizeUrl, codeFrom, endpointOf, grantsAll, pkcePair, randomText } from './oauth.js';
import { Problem } from './problem.js';

/** 이만큼 남으면 미리 갱신한다 (access 토큰은 1시간) */
const EARLY_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;
/** 승인 화면과 기기 목록에 보일 이름 */
const CLIENT_NAME = 'Chrome 확장';
/** 갱신 토큰이 더는 통하지 않는다는 OAuth 오류 */
const DEAD = ['invalid_grant', 'invalid_client'];

export class Connection {
  /**
   * @param {object} deps
   * @param {{ get(key: string): Promise<object>, set(items: object): Promise<void>, remove(key: string): Promise<void> }} deps.store
   * @param {typeof fetch} deps.fetch
   * @param {(url: string) => Promise<string>} deps.launch 승인 창을 열고, 돌아온 주소를 준다
   * @param {string} deps.redirectUri 승인 뒤 돌아올 주소 (https://<확장 id>.chromiumapp.org/)
   * @param {() => number} [deps.now]
   */
  constructor({ store, fetch, launch, redirectUri, now = () => Date.now() }) {
    this.store = store;
    this.fetch = fetch;
    this.launch = launch;
    this.redirectUri = redirectUri;
    this.now = now;
    /** 진행 중인 갱신. 같은 때 여러 곳이 불러도 갱신 토큰은 한 번만 내민다 (두 번 내밀면 서버가 기기를 끊는다) */
    this.refreshing = null;
  }

  /** 토큰 없이 보는 상태: none(연결 안 됨) · connected · lost(다시 연결) */
  async status() {
    const saved = await this.saved();
    if (!saved) return { state: 'none', site: null };
    return { state: saved.accessToken ? 'connected' : 'lost', site: saved.site };
  }

  async connected() {
    return (await this.status()).state === 'connected';
  }

  /**
   * 연결하기. 사이트 권한(origin/*)은 팝업이 사용자 동작 안에서 먼저 받아 둔다.
   * @param {string} origin siteOrigin()으로 고친 블로그 주소
   * @returns {Promise<string>} 블로그의 사이트 주소
   */
  async connect(origin) {
    const about = await this.request(`${origin}/.well-known/oauth-protected-resource/mcp`);
    const mcp = typeof about.resource === 'string' ? about.resource : '';
    if (about.resource_name !== 'Cairn' || !mcp.endsWith('/mcp'))
      throw new Problem(`Cairn 블로그가 아니에요: ${origin}`);
    const site = mcp.slice(0, -'/mcp'.length);
    if (new URL(site).origin !== origin)
      throw new Problem(`블로그의 사이트 주소로 연결해 주세요: ${site}`);
    const meta = await this.request(`${site}/.well-known/oauth-authorization-server`);
    const client = await this.request(endpointOf(meta, 'registration_endpoint'), {
      json: { client_name: CLIENT_NAME, redirect_uris: [this.redirectUri] },
    });
    const clientId = String(client.client_id ?? '');
    const { verifier, challenge } = await pkcePair();
    const state = randomText();
    const returned = await this.approve(
      authorizeUrl(meta, { clientId, redirectUri: this.redirectUri, challenge, state }),
    );
    const token = await this.request(endpointOf(meta, 'token_endpoint'), {
      form: {
        grant_type: 'authorization_code',
        code: codeFrom(returned, { state, issuer: meta.issuer }),
        redirect_uri: this.redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      },
    });
    const revokeEndpoint =
      typeof meta.revocation_endpoint === 'string' ? meta.revocation_endpoint : null;
    if (typeof token.access_token !== 'string' || !grantsAll(token.scope)) {
      // 확장 권한을 모르는 옛 블로그는 넓은 권한의 토큰을 준다. 쥐고 있지 않고 바로 버린다
      await this.revoke(revokeEndpoint, clientId, [token.refresh_token, token.access_token]);
      throw new Problem(
        '블로그가 확장을 모르는 버전이에요. 서버를 새 버전으로 올린 뒤 다시 연결해 주세요',
      );
    }
    await this.store.set({
      connection: {
        site,
        mcp,
        tokenEndpoint: endpointOf(meta, 'token_endpoint'),
        revokeEndpoint,
        clientId,
        accessToken: token.access_token,
        refreshToken: String(token.refresh_token ?? ''),
        expiresAt: this.expiry(token.expires_in),
        scope: String(token.scope),
      },
    });
    return site;
  }

  /**
   * 쓸 수 있는 열쇠 { site, mcp, accessToken }. 끝나 가면 갱신한다.
   * @param {string} [rejected] 서버가 방금 받지 않은 access 토큰 (401). 그 토큰이 아직 저장돼 있으면 갱신한다
   */
  async key(rejected) {
    const saved = await this.saved();
    if (!saved) throw new Problem('블로그에 연결해 주세요', 'none');
    if (!saved.accessToken) throw new Problem('연결이 끊겼어요. 다시 연결해 주세요', 'lost');
    // 다른 호출이 이미 새 토큰을 받았다
    if (rejected && saved.accessToken !== rejected) return saved;
    const left = Date.parse(saved.expiresAt) - this.now();
    if (!rejected && left > EARLY_MS) return saved;
    this.refreshing ??= this.refresh(saved).finally(() => {
      this.refreshing = null;
    });
    try {
      return await this.refreshing;
    } catch (error) {
      // 갱신이 잠깐 안 되면(네트워크) 아직 살아 있는 토큰을 그대로 쓴다
      if (!rejected && left > 0 && error.code !== 'lost') return saved;
      throw error;
    }
  }

  /** 연결 해제: 저장한 열쇠를 지우고 서버에서도 토큰을 버린다 (닿지 않아도 이 브라우저에서는 지운다) */
  async disconnect() {
    const saved = await this.saved();
    await this.store.remove('connection');
    if (saved?.accessToken)
      await this.revoke(saved.revokeEndpoint, saved.clientId, [
        saved.refreshToken,
        saved.accessToken,
      ]);
    return saved?.site ?? null;
  }

  async saved() {
    const { connection } = await this.store.get('connection');
    return connection && typeof connection.site === 'string' ? connection : null;
  }

  async refresh(saved) {
    let token;
    try {
      token = await this.request(saved.tokenEndpoint, {
        form: {
          grant_type: 'refresh_token',
          refresh_token: saved.refreshToken,
          client_id: saved.clientId,
        },
      });
    } catch (error) {
      if (!DEAD.includes(error.code)) throw error;
      // 갱신 토큰이 죽었다 (만료 · 끊김 · 재사용 감지). 다시 내밀지 않게 토큰을 지운다
      await this.store.set({ connection: { site: saved.site, mcp: saved.mcp, lost: true } });
      throw new Problem('연결이 끊겼어요. 다시 연결해 주세요', 'lost');
    }
    if (typeof token.access_token !== 'string') throw new Problem('토큰을 새로 받지 못했어요');
    const next = {
      ...saved,
      accessToken: token.access_token,
      refreshToken: String(token.refresh_token ?? saved.refreshToken),
      expiresAt: this.expiry(token.expires_in),
    };
    await this.store.set({ connection: next });
    return next;
  }

  /** 승인 창. 사용자가 닫거나 실패하면 Problem */
  async approve(url) {
    try {
      return await this.launch(url);
    } catch {
      throw new Problem('승인 창이 닫혀 연결하지 못했어요');
    }
  }

  /** 토큰 버리기 (RFC 7009). 실패해도 넘어간다 */
  async revoke(endpoint, clientId, tokens) {
    if (!endpoint) return;
    for (const token of tokens)
      if (typeof token === 'string' && token)
        await this.request(endpoint, { form: { token, client_id: clientId } }).catch(() => {});
  }

  expiry(expiresIn) {
    return new Date(this.now() + Number(expiresIn ?? 3600) * 1000).toISOString();
  }

  /** GET, JSON POST(json), 폼 POST(form). OAuth 오류면 그 설명과 코드로 Problem */
  async request(url, { json, form } = {}) {
    const init = json
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(json),
        }
      : form
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(form).toString(),
          }
        : { method: 'GET' };
    let res;
    try {
      res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new Problem(`블로그에 닿지 않아요: ${new URL(url).origin}`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = body.error_description ?? body.message ?? body.error ?? res.status;
      throw new Problem(
        `연결하지 못했어요: ${String(why)}`,
        typeof body.error === 'string' ? body.error : null,
      );
    }
    return body;
  }
}
