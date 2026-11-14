import {
  Actor,
  Command,
  NotFound,
  Operation,
  Read,
  type RequestFields,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { ShotImageView, ShotListView, type ShotMeta, ShotSavedView } from './click-views';
import { leasedBrowse } from './job';
import { shots } from './schema';

// 브라우저 작업의 화면 (단계 캡처, 2026-11-14). 결과물이 아니라 이 패키지에 남는다: 결과를 고르지 않아도 증거가 사라지지 않게.
//   step: AI가 단계마다 찍은 것을 러너가 일이 끝난 뒤 올린다. 작업마다 30장, 30일이 지나면 새로 저장할 때 지운다
//   login · before · after · changed: 러너(AI 없음)가 로그인 화면 · 멈춘 화면 · 누른 뒤 · 바뀐 화면을 직접 찍는다. 남긴다

/** 그림 하나의 크기 (DB CHECK와 같다) */
const IMAGE_MAX = 300 * 1024;
/** base64로 받는 칸의 길이 (MCP JSON 한도 512KB 안) */
const IMAGE_TEXT_MAX = Math.ceil(IMAGE_MAX / 3) * 4;
const STEPS_MAX = 30;
const STEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 받은 그림: 바이트와 형식 */
export type ShotImage = { bytes: Buffer; mime: string };

/** base64 칸 하나 (모양만: 300KB · 형식은 run에서 decodeImage가 RuleViolation). required가 아니면 비었을 때 null */
export function imageOf(f: RequestFields, field: string, required: boolean): string | null {
  const text = required
    ? f.text(field, IMAGE_TEXT_MAX + 4)
    : f.optionalText(field, IMAGE_TEXT_MAX + 4);
  if (text && !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) f.reject(field, 'base64가 아니에요');
  return text || null;
}

/** 그림의 앞부분으로 형식을 본다. JPEG · PNG만, 300KB까지 */
export function decodeImage(base64: string): ShotImage {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > IMAGE_MAX)
    throw new RuleViolation(
      `화면은 ${IMAGE_MAX / 1024}KB까지예요 (${Math.ceil(bytes.length / 1024)}KB)`,
    );
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { bytes, mime: 'image/jpeg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { bytes, mime: 'image/png' };
  throw new RuleViolation('JPEG · PNG 화면만 받아요');
}

/** 화면 한 장을 작업의 다음 순번으로 남긴다 */
export async function addShot(
  work: Work,
  spaceId: string,
  taskId: string,
  kind: string,
  image: ShotImage,
  page: { url: string; title: string },
  clickId: string | null = null,
): Promise<{ id: string; seq: number }> {
  const [last] = await work.sql<{ seq: number }[]>`
    SELECT coalesce(max(seq), 0)::int AS seq FROM browser_tabs.shots WHERE task_id = ${taskId}`;
  const seq = (last?.seq ?? 0) + 1;
  await work.insertRows(shots, {
    space_id: spaceId,
    task_id: taskId,
    click_id: clickId,
    kind,
    seq,
    url: page.url.slice(0, 2000),
    title: page.title.slice(0, 300),
    image: image.bytes,
    mime: image.mime,
  });
  const saved = await work.row(shots, { task_id: taskId, seq });
  return { id: saved?.id ?? '', seq };
}

type StepInput = { taskId: string; url: string; title: string; image: string };

/** MCP browser_shot_save: AI가 단계마다 찍은 화면 하나를 남긴다 (러너, 그 작업의 임대를 쥔 러너만) */
export class SaveShot extends Command<StepInput> {
  readonly name = 'saveShot';
  readonly allow = Actor.RUN;

  input(raw: unknown): StepInput {
    return this.fields(raw, (f) => ({
      taskId: f.uuid('task_id'),
      url: f.optionalText('url', 2000) ?? '',
      title: f.optionalText('title', 300) ?? '',
      image: imageOf(f, 'image', true) ?? '',
    }));
  }

  async run(work: Work, actor: Actor, input: StepInput): Promise<ShotSavedView> {
    const job = await leasedBrowse(work, input.taskId);
    const space = actor.requireSpace();
    const image = decodeImage(input.image);
    const steps = await work.rows(shots, { task_id: job.id, kind: 'step' });
    if (steps.length >= STEPS_MAX)
      throw new RuleViolation(`단계 화면은 작업마다 ${STEPS_MAX}장까지예요`);
    await work.deleteRows(shots, {
      space_id: space,
      kind: 'step',
      created_at: Rule.before(new Date(Date.now() - STEP_DAYS * DAY_MS)),
    });
    const saved = await addShot(work, space, job.id, 'step', image, input);
    return new ShotSavedView(saved.id, saved.seq);
  }
}

/** GET /api/p/browser-tabs/shots?taskId=: 작업의 화면 목록, 그림 없이 (관리자) */
export class ListShots extends Read<{ taskId: string }> {
  readonly name = 'listShots';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { taskId: string } {
    return this.fields(raw, (f) => ({ taskId: f.uuid('taskId') }));
  }

  async run(work: Work, actor: Actor, input: { taskId: string }): Promise<ShotListView> {
    return new ShotListView(await shotsOf(work, actor.requireSpace(), input.taskId));
  }
}

/** 작업의 화면들, 그림 없이 순번대로 */
export function shotsOf(work: Work, spaceId: string, taskId: string): Promise<ShotMeta[]> {
  return work.sql<ShotMeta[]>`
    SELECT id, space_id, task_id, click_id, kind, seq, url, title, mime, created_at
    FROM browser_tabs.shots WHERE space_id = ${spaceId} AND task_id = ${taskId} ORDER BY seq`;
}

/** GET /api/p/browser-tabs/shots/:id: 화면 하나와 그림 (관리자) */
export class ShotDetail extends Read<{ id: string }> {
  readonly name = 'shot';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<ShotImageView> {
    const row = await work.row(shots, { id: input.id, space_id: actor.requireSpace() });
    if (!row) throw new NotFound('없는 화면이에요');
    return new ShotImageView(row);
  }
}
