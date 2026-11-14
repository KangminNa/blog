import { BaseRequest } from '../../platform';
import { SkillFiles } from './skill-files';

/** 스킬 이름 (주소에서). 모양만 보고, 러너 스킬인지는 Service가 본다 */
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** POST api/runner-skills/:name/revisions: 새 판. version은 화면이 불러올 때 받은 값 (콘솔 판이 없으면 0) */
export class SaveSkillRevisionInput extends BaseRequest {
  private static readonly NOTE_MAX = 500;
  private static readonly VERSION_MAX = 2_147_483_647;

  private constructor(
    readonly name: string,
    readonly requestId: string,
    readonly files: Readonly<Record<string, string>>,
    readonly note: string,
    readonly version: number,
  ) {
    super();
  }

  static from(name: string, raw: unknown): SaveSkillRevisionInput {
    return BaseRequest.read(raw, (f) => {
      if (!NAME.test(name)) f.reject('name', '스킬 이름이 틀려요');
      return new SaveSkillRevisionInput(
        name,
        f.uuid('requestId'),
        Object.fromEntries(f.textMap('files', SkillFiles.FILE_MAX)),
        f.optionalText('note', SaveSkillRevisionInput.NOTE_MAX) ?? '',
        f.integer('version', 0, SaveSkillRevisionInput.VERSION_MAX),
      );
    });
  }
}

/** PUT api/runner-skills/:name/active: 쓸 판. revision이 null이면 저장소 판 (꼭 보낸다) */
export class ActivateSkillInput extends BaseRequest {
  private static readonly VERSION_MAX = 2_147_483_647;

  private constructor(
    readonly name: string,
    readonly revision: number | null,
    readonly version: number,
  ) {
    super();
  }

  static from(name: string, raw: unknown): ActivateSkillInput {
    const told = typeof raw === 'object' && raw !== null && 'revision' in raw;
    return BaseRequest.read(raw, (f) => {
      if (!NAME.test(name)) f.reject('name', '스킬 이름이 틀려요');
      if (!told) f.reject('revision', '쓸 버전(revision)을 보내 주세요. 저장소 버전이면 null');
      return new ActivateSkillInput(
        name,
        f.optionalInteger('revision', 1, ActivateSkillInput.VERSION_MAX),
        f.integer('version', 1, ActivateSkillInput.VERSION_MAX),
      );
    });
  }
}
