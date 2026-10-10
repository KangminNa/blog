import type { PluginContext } from './plugin-context';
import type { PluginManifest } from './plugin-manifest';

// 서버 코드를 가진 플러그인의 부모. 목록 파일의 `server` 파일이 이 클래스를 상속한 클래스를 default로 내보낸다.
//
//   export default class SyncGithubPlugin extends BasePlugin {
//     register(cairn: PluginContext): void { cairn.every('5m', new SyncJob(...)); }
//   }
export abstract class BasePlugin {
  constructor(readonly manifest: PluginManifest) {}

  get name(): string {
    return this.manifest.name;
  }

  /** 확장 지점에 등록하는 곳은 여기 하나. 서버가 시작할 때 한 번 부른다 */
  abstract register(cairn: PluginContext): void;
}
