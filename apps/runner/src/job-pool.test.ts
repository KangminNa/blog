import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { JobPool } from './job-pool';

// 러너의 자리: 동시에 도는 일의 수와 브라우저 작업 하나.

/** 밖에서 끝낼 수 있는 일 */
function work(): { promise: Promise<void>; finish: () => void } {
  let finish = () => {};
  const promise = new Promise<void>((done) => {
    finish = done;
  });
  return { promise, finish };
}

const tick = () => new Promise((done) => setImmediate(done));

describe('러너의 자리', () => {
  test('자리만큼 앉히고, 일이 끝나면 자리가 빈다', async () => {
    const pool = new JobPool(2);
    const [a, b] = [work(), work()];
    pool.add(a.promise);
    pool.add(b.promise);
    assert.equal(pool.free, 0);

    let vacant = false;
    const waiting = pool.vacancy(new AbortController().signal).then(() => {
      vacant = true;
    });
    await tick();
    assert.equal(vacant, false, '자리가 없으면 기다린다');
    a.finish();
    await waiting;
    assert.equal(pool.free, 1);
    b.finish();
    await pool.drain();
    assert.equal(pool.free, 2);
  });

  test('멈추라고 하면 자리가 없어도 기다리지 않는다', async () => {
    const pool = new JobPool(1);
    const a = work();
    pool.add(a.promise);
    const stop = new AbortController();
    const waiting = pool.vacancy(stop.signal);
    stop.abort();
    await waiting;
    assert.equal(pool.free, 0);
    a.finish();
    await pool.drain();
  });

  test('브라우저 작업이 도는 동안만 브라우저가 바쁘다', async () => {
    const pool = new JobPool(3);
    const [plain, browse] = [work(), work()];
    pool.add(plain.promise);
    assert.equal(pool.browserBusy, false);
    pool.add(browse.promise, true);
    assert.equal(pool.browserBusy, true);
    browse.finish();
    await tick();
    assert.equal(pool.browserBusy, false);
    plain.finish();
    await pool.drain();
  });
});
