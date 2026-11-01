import { BaseRequest } from '../../platform';

const VERSION_MAX = 2_147_483_647;

/** PUT /api/tidy/settings { autoTidy, version }. 행이 없을 때의 version은 0이다 */
export class SaveTidySettingsInput extends BaseRequest {
  private constructor(
    readonly autoTidy: boolean,
    readonly version: number,
  ) {
    super();
  }

  static from(raw: unknown): SaveTidySettingsInput {
    return BaseRequest.read(
      raw,
      (f) => new SaveTidySettingsInput(f.boolean('autoTidy'), f.integer('version', 0, VERSION_MAX)),
    );
  }
}

/** vault.session.saved 이벤트의 내용 중 정리에 쓰는 칸 */
export class SessionSavedInput extends BaseRequest {
  private constructor(
    readonly sessionId: string,
    readonly seq: number,
  ) {
    super();
  }

  static from(data: unknown): SessionSavedInput {
    return BaseRequest.read(
      data,
      (f) => new SessionSavedInput(f.uuid('sessionId'), f.integer('seq', 1, VERSION_MAX)),
    );
  }
}
