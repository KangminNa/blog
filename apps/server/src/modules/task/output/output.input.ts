import { BaseRequest } from '../../platform';
import { OutputPolicy } from './output.policy';

const SHA256 = /^[0-9a-f]{64}$/;

/** MCP begin_upload: 러너가 올릴 파일 하나. 이름 규칙은 OutputPolicy가 본다 (모양만 여기서) */
export class BeginUploadInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly name: string,
    readonly size: number,
    readonly sha256: string,
  ) {
    super();
  }

  static from(raw: unknown): BeginUploadInput {
    return BaseRequest.read(raw, (f) => {
      const sha256 = f.text('sha256', 64);
      if (!SHA256.test(sha256)) f.reject('sha256', '소문자 16진수 64자여야 해요');
      return new BeginUploadInput(
        f.uuid('task_id'),
        f.text('name', OutputPolicy.NAME_MAX),
        f.integer('size', 1, OutputPolicy.FILE_MAX),
        sha256,
      );
    });
  }
}

/** GET api/outputs: 종류 · 작업으로 거르기, 휴지통 보기, 앞 응답의 next */
export class ListOutputsInput extends BaseRequest {
  private constructor(
    readonly kind: string | null,
    readonly taskId: string | null,
    readonly trash: boolean,
    readonly cursor: string | null,
  ) {
    super();
  }

  static from(raw: unknown): ListOutputsInput {
    const query = raw as Record<string, unknown>;
    return BaseRequest.read(raw, (f) => {
      const kind = f.optionalText('kind', 20);
      if (kind !== null && !(OutputPolicy.KINDS as readonly string[]).includes(kind))
        f.reject('kind', `${OutputPolicy.KINDS.join(' · ')} 중 하나예요`);
      return new ListOutputsInput(
        kind,
        query.taskId ? f.uuid('taskId') : null,
        query.trash === '1' || query.trash === 'true',
        query.cursor ? f.uuid('cursor') : null,
      );
    });
  }
}

/** GET api/outputs/:id/file: inline=1이면 미리 보기 (열어도 되는 형식만) */
export class OutputFileInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly inline: boolean,
  ) {
    super();
  }

  static from(id: string, raw: unknown): OutputFileInput {
    const query = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      { ...query, id },
      (f) => new OutputFileInput(f.uuid('id'), query.inline === '1'),
    );
  }
}

/** 지우기 · 되살리기 · 바로 지우기: 화면이 본 version */
export class OutputActionInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): OutputActionInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      { ...body, id },
      (f) => new OutputActionInput(f.uuid('id'), f.version()),
    );
  }
}
