// 블로그의 OAuth 2.1 (PKCE S256)에 쓰는 값 만들기와 읽기. 연결 명령(packages/cli의 news-login)과 같은 서버 주소를 쓴다.
// 여기는 화면 · 저장 · 네트워크 없이 값만 다룬다 (연결 흐름은 connection.js).
import { Problem } from './problem.js';

/** 확장이 요청하는 권한. 서버는 이 이름을 받으면 아래 세 권한만 가진 기기를 만든다 */
export const SCOPE = 'extension';
/** 받은 토큰에 꼭 있어야 하는 권한: 대화 올리기 · 맡기기 · 기다리는 결재 수 */
const NEEDED = ['upload', 'delegate', 'inbox'];

/**
 * 입력한 블로그 주소 → origin. 주소 규칙은 서버 · 연결 명령과 같다: https만, 이 컴퓨터 안의 주소(localhost 등)만 http도.
 * 틀리면 Problem
 */
export function siteOrigin(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Problem('블로그 주소를 넣어 주세요');
  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new Problem(`주소 모양이 아니에요: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Problem('https://로 시작하는 주소로 넣어 주세요');
  if (url.protocol === 'http:' && !isLocal(url.hostname))
    throw new Problem('https 주소만 쓸 수 있어요 (localhost는 http도 가능)');
  return url.origin;
}

function isLocal(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

/** 바이트 → base64url (채움 문자 없이) */
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** 무작위 글자 (바이트 수만큼) */
export function randomText(size = 16) {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}

/** PKCE 한 쌍: 확장이 쥐는 verifier와 서버에 먼저 보내는 challenge(S256) */
export async function pkcePair() {
  const verifier = randomText(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** 안내 문서(/.well-known/oauth-authorization-server)의 주소 하나. 없으면 Problem */
export function endpointOf(meta, key) {
  const value = meta?.[key];
  if (typeof value !== 'string' || !value)
    throw new Problem(`블로그의 OAuth 안내에 ${key}가 없어요`);
  return value;
}

/** 승인 화면 주소 */
export function authorizeUrl(meta, { clientId, redirectUri, challenge, state }) {
  const url = new URL(endpointOf(meta, 'authorization_endpoint'));
  const values = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: SCOPE,
  };
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * 승인 뒤 돌아온 주소 → code. 이 요청의 것이 아니거나(state) 다른 블로그가 보냈거나(iss) 거절이면 Problem
 * @param {string} returned 돌아온 주소 (https://<확장 id>.chromiumapp.org/?code=…)
 */
export function codeFrom(returned, { state, issuer }) {
  let back;
  try {
    back = new URL(returned).searchParams;
  } catch {
    throw new Problem('승인 응답을 읽지 못했어요');
  }
  if (back.get('state') !== state) throw new Problem('승인 응답이 이 요청의 것이 아니에요');
  const iss = back.get('iss');
  if (iss && issuer && iss !== issuer) throw new Problem('다른 블로그가 보낸 승인 응답이에요');
  const error = back.get('error');
  if (error)
    throw new Problem(`연결하지 못했어요: ${back.get('error_description') ?? error}`, error);
  const code = back.get('code');
  if (!code) throw new Problem('승인 응답에 code가 없어요');
  return code;
}

/** 받은 토큰의 권한(공백으로 나눈 이름들)에 확장이 쓰는 권한이 다 있는가 */
export function grantsAll(scope) {
  const granted = new Set(String(scope ?? '').split(/\s+/));
  return NEEDED.every((name) => granted.has(name));
}
