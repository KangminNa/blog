/** 세션 노트의 재료 (vault read_transcript): 세션의 머리와 원문. NoteStage가 지시문 틀 session-note를 채운다 */
export class NoteSource {
  constructor(
    readonly title: string | null,
    readonly tool: string,
    readonly project: string | null,
    /** 서버가 AI에게 줄 만큼 가운데를 줄인 원문 */
    readonly text: string,
  ) {}
}
