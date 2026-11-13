import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { AgentActor, ExternalFailure, RuleViolation } from '../../platform';
import { HtmlText } from './html-text';
import { WebPageGateway } from './web-page.gateway';
import { WebReach } from './web-reach.policy';

// 주소 읽기(read_url)의 목줄과 받기. 받기는 127.0.0.1의 가짜 사이트로 본다 (시험에서만 루프백을 연다).

const agent = (scopes: string[], reads: string[] = []) =>
  new AgentActor(randomUUID(), randomUUID(), randomUUID(), new Set(scopes), new Set(reads));
const url = (text: string) => new URL(text);

describe('WebReach: 어디까지 열까', () => {
  const ORDER = '이 글 요약해 줘 https://News.Example.com/a/1?x=2, 그리고 www.blog.co.kr 도. 끝.';

  test('지시에서 사이트를 뽑는다 (소문자, www. 없이, 끝의 문장부호 빼고)', () => {
    assert.deepEqual([...WebReach.hostsIn(ORDER)].sort(), ['blog.co.kr', 'news.example.com']);
    assert.deepEqual([...WebReach.hostsIn('주소 없음')], []);
  });

  test('비공개를 볼 수 없는 일은 공개 주소 어디든', () => {
    for (const scopes of [[], [AgentActor.MAKE], [AgentActor.READ_PUBLIC, AgentActor.BROWSE]]) {
      const reach = WebReach.of(agent(scopes), '주소 없는 지시');
      assert.equal(reach.open, true, scopes.join());
      reach.assertAllowed(url('https://anywhere.example.org/page'));
    }
  });

  test('비공개를 볼 수 있으면(전체 읽기 · 쓰기 · 코드 · 재료 허락) 지시에 적힌 사이트와 그 하위만', () => {
    for (const actor of [
      agent([AgentActor.READ_ALL]),
      agent([AgentActor.WRITE]),
      agent([AgentActor.CODE]),
      agent([AgentActor.MAKE], [randomUUID()]),
    ]) {
      const reach = WebReach.of(actor, ORDER);
      assert.equal(reach.open, false);
      reach.assertAllowed(url('https://news.example.com/other'));
      reach.assertAllowed(url('https://m.news.example.com/'));
      reach.assertAllowed(url('http://www.blog.co.kr/post'));
      assert.throws(
        () => reach.assertAllowed(url('https://evil.example.net/?q=secret')),
        RuleViolation,
      );
      assert.throws(
        () => reach.assertAllowed(url('https://example.com/')),
        RuleViolation,
        '상위 도메인은 아니다',
      );
      assert.throws(
        () => reach.assertAllowed(url('https://news.example.com.evil.net/')),
        RuleViolation,
      );
    }
    assert.throws(
      () =>
        WebReach.of(agent([AgentActor.WRITE]), '주소 없는 지시').assertAllowed(
          url('https://a.com'),
        ),
      /지시에 주소가 없어요/,
    );
  });

  test('아이디가 든 주소와 다른 스킴은 열지 않는다', () => {
    const reach = WebReach.of(agent([]), '');
    assert.throws(() => reach.assertAllowed(url('https://user:pw@example.com/')), RuleViolation);
    assert.throws(() => reach.assertAllowed(url('file:///etc/passwd')), RuleViolation);
  });
});

describe('HtmlText', () => {
  test('스크립트 · 스타일을 버리고 글자와 줄만 남긴다', () => {
    const html = `<html><head><title>제목 &amp; 부제</title><style>p{}</style></head>
      <body><script>alert(1)</script><h1>머리</h1><p>첫&nbsp;문단 &#xAC00;&#45208;</p><!-- 주석 --><ul><li>하나</li><li>둘</li></ul></body></html>`;
    assert.equal(HtmlText.title(html), '제목 & 부제');
    assert.equal(HtmlText.body(html), '머리\n\n첫 문단 가나\n\n하나\n\n둘');
  });
});

describe('WebPageGateway: 받기와 내부망 막기', () => {
  let server: Server;
  let base: string;
  const gateway = new WebPageGateway();
  const any = () => {};

  before(async () => {
    process.env[WebPageGateway.TEST_LOOPBACK_ENV] = '1';
    server = createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<title>가짜 사이트</title><p>본문 글자</p>');
      }
      if (path === '/euc-kr') {
        res.writeHead(200, { 'content-type': 'text/html' });
        // "한글"을 euc-kr로 (meta로만 알린다)
        return res.end(
          Buffer.concat([
            Buffer.from('<meta charset="euc-kr"><p>'),
            Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]),
            Buffer.from('</p>'),
          ]),
        );
      }
      if (path === '/hop') {
        res.writeHead(302, { location: '/page' });
        return res.end();
      }
      if (path === '/loop') {
        res.writeHead(302, { location: '/loop' });
        return res.end();
      }
      if (path === '/to-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        return res.end();
      }
      if (path === '/pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return res.end('%PDF-1.4');
      }
      if (path === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('가'.repeat(WebPageGateway.MAX_BYTES));
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    delete process.env[WebPageGateway.TEST_LOOPBACK_ENV];
    server.close();
  });

  test('페이지의 제목과 글자를 받는다. 리다이렉트를 따라가고 마지막 주소를 알린다', async () => {
    const page = await gateway.read(url(`${base}/hop`), any);
    assert.deepEqual(
      [page.url, page.title, page.text, page.truncated],
      [`${base}/page`, '가짜 사이트', '본문 글자', false],
    );
  });

  test('meta의 문자 집합(euc-kr)으로 읽는다', async () => {
    assert.equal((await gateway.read(url(`${base}/euc-kr`), any)).text, '한글');
  });

  test('리다이렉트마다 목줄을 다시 묻는다', async () => {
    const seen: string[] = [];
    await gateway.read(url(`${base}/hop`), (u) => void seen.push(u.pathname));
    assert.deepEqual(seen, ['/hop', '/page']);
    await assert.rejects(
      gateway.read(url(`${base}/hop`), (u) => {
        if (u.pathname === '/page') throw new RuleViolation('막음');
      }),
      /막음/,
    );
  });

  test('내부망 · 메타데이터 주소는 직접이든 리다이렉트든 열지 않는다', async () => {
    for (const target of [
      'http://10.0.0.5/',
      'http://169.254.169.254/',
      'http://[fd00::1]/',
      'http://192.168.0.1:8080/',
    ])
      await assert.rejects(gateway.read(url(target), any), /내부망/, target);
    await assert.rejects(gateway.read(url(`${base}/to-metadata`), any), /내부망/);
  });

  test('시험용 루프백 열기를 끄면 127.0.0.1 · localhost도 막힌다', async () => {
    delete process.env[WebPageGateway.TEST_LOOPBACK_ENV];
    try {
      await assert.rejects(gateway.read(url(`${base}/page`), any), /내부망/);
      await assert.rejects(gateway.read(url('http://localhost:9/'), any), /내부망/);
    } finally {
      process.env[WebPageGateway.TEST_LOOPBACK_ENV] = '1';
    }
  });

  test('리다이렉트가 너무 많거나, 글이 아니거나, 없는 페이지면 이유를 알린다', async () => {
    await assert.rejects(gateway.read(url(`${base}/loop`), any), /3번 넘게/);
    await assert.rejects(
      gateway.read(url(`${base}/pdf`), any),
      /글이 아닌 형식이에요 \(application\/pdf\)/,
    );
    await assert.rejects(
      gateway.read(url(`${base}/nothing`), any),
      (e: Error) => e instanceof ExternalFailure && /404/.test(e.message),
    );
  });

  test('너무 크면 앞부분만 받고 잘렸다고 알린다', async () => {
    const page = await gateway.read(url(`${base}/big`), any);
    assert.equal(page.truncated, true);
    assert.equal(page.text.length, WebPageGateway.TEXT_MAX);
  });
});
