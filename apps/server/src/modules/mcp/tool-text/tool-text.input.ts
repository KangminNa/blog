import { BaseRequest } from '../../platform';
import { ToolText } from './tool-text';

/** 도구 이름 (주소에서). 모양만 보고, 지금 열린 도구인지는 Service가 본다 */
const TOOL = /^[a-z][a-z0-9_]{0,63}$/;
const VERSION_MAX = 2_147_483_647;

/**
 * POST api/tool-texts/:tool/revisions: 새 판. input은 칸 경로 → 설명 (빈 칸은 기본 글).
 * version은 화면이 불러올 때 받은 값 (콘솔 판이 없으면 0)
 */
export class SaveToolTextInput extends BaseRequest {
  private constructor(
    readonly tool: string,
    readonly requestId: string,
    readonly description: string,
    readonly input: Readonly<Record<string, string>>,
    readonly note: string,
    readonly version: number,
  ) {
    super();
  }

  static from(tool: string, raw: unknown): SaveToolTextInput {
    return BaseRequest.read(raw, (f) => {
      if (!TOOL.test(tool)) f.reject('tool', '도구 이름이 틀려요');
      return new SaveToolTextInput(
        tool,
        f.uuid('requestId'),
        f.text('description', ToolText.DESCRIPTION_MAX),
        Object.fromEntries(f.textMap('input', ToolText.FIELD_MAX)),
        f.optionalText('note', ToolText.NOTE_MAX) ?? '',
        f.integer('version', 0, VERSION_MAX),
      );
    });
  }
}

/** PUT api/tool-texts/:tool/active: 쓸 판. revision이 null이면 기본 글 (꼭 보낸다) */
export class ActivateToolTextInput extends BaseRequest {
  private constructor(
    readonly tool: string,
    readonly revision: number | null,
    readonly version: number,
  ) {
    super();
  }

  static from(tool: string, raw: unknown): ActivateToolTextInput {
    const told = typeof raw === 'object' && raw !== null && 'revision' in raw;
    return BaseRequest.read(raw, (f) => {
      if (!TOOL.test(tool)) f.reject('tool', '도구 이름이 틀려요');
      if (!told) f.reject('revision', '쓸 버전(revision)을 보내 주세요. 기본 글이면 null');
      return new ActivateToolTextInput(
        tool,
        f.optionalInteger('revision', 1, VERSION_MAX),
        f.integer('version', 1, VERSION_MAX),
      );
    });
  }
}
