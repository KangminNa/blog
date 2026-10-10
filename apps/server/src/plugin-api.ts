// 플러그인이 가져다 쓸 수 있는 유일한 입구. 플러그인 서버 파일은 이 파일만 import한다 (pnpm check가 막는다).
// 여기서 내보내는 것을 바꾸면 플러그인 API 버전(CAIRN_PLUGIN_API)과 docs/객체설계.md 12장을 함께 고친다.
export {
  ActionResult,
  Actor,
  ArchiveFile,
  BaseAction,
  BaseGateway,
  BaseHandler,
  BaseJob,
  BasePlugin,
  DomainError,
  DomainEvent,
  ExternalFailure,
  OwnerActor,
  type PluginContext,
  SystemActor,
  VisitorActor,
} from './modules/platform';
