import { BaseRequest } from '../../platform';

const VERSION_MAX = 2_147_483_647;

/** POST /api/runners/:id/accepting: 일 받기 켜기·끄기. 본 version을 함께 보낸다 (낙관적 잠금) */
export class RunnerAcceptingInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly accepting: boolean,
  ) {
    super();
  }

  static from(id: string, raw: unknown): RunnerAcceptingInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new RunnerAcceptingInput(
          f.uuid('id'),
          f.integer('version', 1, VERSION_MAX),
          f.boolean('accepting'),
        ),
    );
  }
}
