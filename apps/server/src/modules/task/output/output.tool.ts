import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { BeginUploadInput } from './output.input';
import { OutputPolicy } from './output.policy';
import { OutputService } from './output.service';
import type { UploadTicketView } from './output.view';

/** 러너가 결과물 하나를 올리기 전에 받는 표. 본문은 이 표로 PUT api/outputs/upload에 보낸다 (MCP로 보내지 않는다) */
@Injectable()
export class BeginUploadTool extends BaseTool {
  readonly name = 'begin_upload';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  readonly description =
    '작업이 만든 파일 하나를 결과물로 올릴 표를 받는다. 임대를 쥔 실행만. 받은 upload_path에 PUT으로, 머리글 header: token을 붙여 파일 그대로 보낸다 (10분 안에).';
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid', description: '작업 id' },
      name: {
        type: 'string',
        maxLength: OutputPolicy.NAME_MAX,
        description: '파일 이름 (폴더 없이)',
      },
      size: { type: 'integer', minimum: 1, maximum: OutputPolicy.FILE_MAX, description: '바이트' },
      sha256: {
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
        description: '내용의 sha256 (소문자 16진수)',
      },
    },
    required: ['task_id', 'name', 'size', 'sha256'],
  };

  constructor(private readonly outputs: OutputService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<UploadTicketView> {
    return this.outputs.beginUpload(actor, BeginUploadInput.from(raw));
  }
}
