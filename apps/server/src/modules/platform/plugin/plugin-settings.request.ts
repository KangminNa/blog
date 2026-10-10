import { BaseRequest } from '../base/base-request';

// 설정 여러 개를 한 번에: { "values": { "repo": "me/archive", "token": "…" } }. 빈 문자열은 지우기
export class PluginSettingsRequest extends BaseRequest {
  private constructor(readonly values: ReadonlyMap<string, string>) {
    super();
  }

  static from(raw: unknown): PluginSettingsRequest {
    return BaseRequest.read(raw, (f) => new PluginSettingsRequest(f.textMap('values', 2000)));
  }
}
