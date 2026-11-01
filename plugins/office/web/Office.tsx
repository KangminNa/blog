'use client';

import { useEffect, useRef, useState } from 'react';
import { CairnFeed, type Desk, type DeskState } from './cairn-feed';
import { CairnReader, watchCairn } from './cairn-read';

// 콘솔의 오피스 자리(task.office). 왼쪽은 픽셀 사무실, 옆은 같은 내용의 목록이다: 캔버스로만 보이는 것을 두지 않는다.
// 이 파일은 글 화면의 번들에도 함께 들어가므로(화면 자리 목록이 한 곳이다) 무거운 그리기 코드는 켜졌을 때만 불러온다.

const STATE_LABEL: Record<DeskState, string> = {
  running: '실행 중',
  waiting: '결재 대기',
  paused: '중지',
  held: '쉬는 중',
  idle: '대기',
};

const STATE_PILL: Record<DeskState, string> = {
  running: 'pill',
  waiting: 'pill on',
  paused: 'pill off',
  held: 'pill strong',
  idle: 'pill off',
};

const TAG_STYLE = {
  position: 'absolute',
  transform: 'translate(-50%, -100%)',
  padding: '0 5px',
  border: '1px solid var(--line-strong)',
  borderRadius: 4,
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 11,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
} as const;

function taskPath(taskId: string): string {
  return `/admin/tasks/${taskId}`;
}

export default function Office() {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const [desks, setDesks] = useState<readonly Desk[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [noArt, setNoArt] = useState(false);

  useEffect(() => {
    const feed = new CairnFeed();
    const reader = new CairnReader();
    let gone = false;
    let stopStage = () => {};

    const stopWatching = watchCairn(async () => {
      try {
        const snapshot = await reader.read();
        if (gone) return;
        setDesks(feed.push(snapshot));
        setProblem(null);
      } catch (error) {
        if (!gone) setProblem(error instanceof Error ? error.message : '읽지 못했어요');
      }
    });

    const boxEl = box.current;
    const frameEl = frame.current;
    const canvasEl = canvas.current;
    const tagsEl = tags.current;
    if (boxEl && frameEl && canvasEl && tagsEl) {
      import('./stage')
        .then(({ OfficeStage }) =>
          OfficeStage.open(
            { box: boxEl, frame: frameEl, canvas: canvasEl, tags: tagsEl },
            feed,
            (pixelId) => feed.taskOf(pixelId) !== null,
            (pixelId) => {
              const taskId = feed.taskOf(pixelId);
              if (taskId) window.location.assign(taskPath(taskId));
            },
          ),
        )
        .then((stage) => {
          if (gone) stage.stop();
          else stopStage = () => stage.stop();
        })
        .catch(() => {
          if (!gone) setNoArt(true);
        });
    }

    return () => {
      gone = true;
      stopWatching();
      stopStage();
      feed.dispose();
    };
  }, []);

  const count = desks?.length ?? 0;

  return (
    <>
      {problem && <p className="error">{problem}</p>}
      {noArt && (
        <p className="error">사무실 그림을 불러오지 못했어요. 목록은 그대로 볼 수 있어요</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
        <div
          ref={box}
          style={{
            flex: '1 1 640px',
            minWidth: 0,
            overflow: 'hidden',
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--raised)',
          }}
        >
          <div ref={frame} style={{ position: 'relative', maxWidth: '100%', margin: '0 auto' }}>
            <canvas
              ref={canvas}
              width={320}
              height={208}
              role="img"
              aria-label={`에이전트 ${count}명이 있는 픽셀 사무실`}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                imageRendering: 'pixelated',
                filter: 'grayscale(1)',
              }}
            />
            <div
              ref={tags}
              aria-hidden="true"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              {desks?.map((desk) => (
                <span key={desk.agentId} data-pixel={desk.pixelId} style={TAG_STYLE} hidden>
                  {desk.name}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          {desks === null || desks.length === 0 ? (
            <p className="rows-empty">{desks === null ? '불러오는 중…' : '에이전트 없음'}</p>
          ) : (
            <ul className="list" aria-label="에이전트 상태">
              {desks.map((desk) => (
                <li key={desk.agentId}>
                  <a className="item" href={desk.task ? taskPath(desk.task.id) : '/admin/agents'}>
                    <div className="item-main">
                      <b>{desk.name}</b>
                      <small>{desk.task?.lastEvent ?? desk.task?.title ?? '작업 없음'}</small>
                    </div>
                    <span className={STATE_PILL[desk.state]}>
                      {desk.state === 'running' && <span className="dot run" aria-hidden="true" />}
                      {STATE_LABEL[desk.state]}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
