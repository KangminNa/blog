import { BaseRequest } from '../base/base-request';

// 설정 여러 개를 한 번에: { "values": { "repo": "me/archive", "token": "…" } }. 빈 문자열은 지우기
export class PluginSettingsInput extends BaseRequest {
  private constructor(readonly values: ReadonlyMap<string, string>) {
    super();
  }

  static from(raw: unknown): PluginSettingsInput {
    return BaseRequest.read(raw, (f) => new PluginSettingsInput(f.textMap('values', 2000)));
  }
}
