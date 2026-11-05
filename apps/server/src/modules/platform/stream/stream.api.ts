import type { ServerResponse } from 'node:http';
import { Controller, Get, Res } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { ChangeStream } from './change-stream';

// 콘솔의 변경 알림 (SSE). 신호({ topic, id })만 보내고, 화면은 REST로 다시 읽는다. 주인만.
// HttpSetup이 모든 응답에 no-store를 걸지만 여기서는 no-transform까지 필요하다.
// 없으면 Next의 압축이 스트림을 모아 두었다가 끝날 때 한꺼번에 보낸다 (Next 16.4.2에서 시험, API설계 6장).
@Controller('api/stream')
export class StreamController {
  private static readonly KEEP_ALIVE_MS = 25_000;

  constructor(private readonly changes: ChangeStream) {}

  @Get()
  async open(@CurrentActor() actor: Actor, @Res() res: ServerResponse): Promise<void> {
    actor.assertOwner();
    let closed = false;
    let stop = (): void => {};
    let keepAlive: NodeJS.Timeout | undefined;
    // 연결이 끊긴 것은 응답의 close로 안다 (요청의 close는 요청을 다 읽었을 때도 난다).
    // 구독을 기다리는 사이에 끊겨도 놓치지 않게 먼저 건다
    res.on('close', () => {
      closed = true;
      clearInterval(keepAlive);
      stop();
    });
    stop = await this.changes.subscribe(
      (signal) => {
        if (signal.spaceId !== actor.spaceId) return;
        res.write(`data: ${JSON.stringify({ topic: signal.topic, id: signal.id })}\n\n`);
      },
      () => res.end(),
    );
    if (closed) {
      stop();
      return;
    }
    keepAlive = setInterval(() => res.write(': 연결 유지\n\n'), StreamController.KEEP_ALIVE_MS);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': 연결됨\n\n');
  }
}
