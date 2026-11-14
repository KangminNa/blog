// 단위 테스트의 가짜: chrome.storage.local 모양의 저장소와, 주소별로 답하는 fetch.

/** chrome.storage.local처럼 값을 복사해 넣고 꺼낸다 */
export class MemoryStore {
  constructor(items = {}) {
    this.items = structuredClone(items);
  }

  async get(key) {
    return Object.hasOwn(this.items, key) ? { [key]: structuredClone(this.items[key]) } : {};
  }

  async set(values) {
    Object.assign(this.items, structuredClone(values));
  }

  async remove(key) {
    delete this.items[key];
  }
}

/**
 * 'METHOD 주소' → (요청) => { status?, body } 로 답하는 fetch. 부른 요청을 calls에 적는다.
 * 본문이 폼이면 form, JSON이면 json으로 읽어 둔다
 */
export class FakeFetch {
  constructor(routes = {}) {
    this.routes = routes;
    this.calls = [];
    this.fetch = (url, init) => this.answer(url, init);
  }

  async answer(url, init = {}) {
    const method = init.method ?? 'GET';
    const type = init.headers?.['content-type'] ?? '';
    const request = {
      method,
      url,
      headers: init.headers ?? {},
      form: type.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(init.body)) : null,
      json: type.includes('json') ? JSON.parse(init.body) : null,
    };
    this.calls.push(request);
    const route = this.routes[`${method} ${url}`];
    if (!route) throw new TypeError('fetch failed');
    const { status = 200, body = {} } = await route(request);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  /** 주소 하나로 간 요청들 */
  to(url) {
    return this.calls.filter((call) => call.url === url);
  }
}
