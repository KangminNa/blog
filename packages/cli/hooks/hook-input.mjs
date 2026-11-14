// 훅의 표준 입력: Claude Code가 주는 JSON 한 덩어리 (session_id · cwd · transcript_path …). Node 내장 모듈만 쓴다.

/** 표준 입력의 JSON. 없거나 깨졌거나 300ms 안에 끝나지 않으면 빈 것 */
export function readHookInput() {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((resolve) => {
    let raw = '';
    const done = () => {
      process.stdin.destroy();
      try {
        const input = JSON.parse(raw);
        resolve(input && typeof input === 'object' ? input : {});
      } catch {
        resolve({});
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    setTimeout(done, 300).unref();
  });
}
