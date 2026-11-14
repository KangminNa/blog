import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { BeginDownloadInput, BeginUploadInput } from './output.input';
import { OutputPolicy } from './output.policy';
import { OutputQuery } from './output.query';
import { OutputService } from './output.service';
import type { DownloadTicketView, UploadTicketView } from './output.view';

/** 러너가 결과물 하나를 올리기 전에 받는 표. 본문은 이 표로 PUT api/outputs/upload에 보낸다 (MCP로 보내지 않는다) */
@Injectable()
export class BeginUploadTool extends BaseTool {
  readonly name = 'begin_upload';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      name: {
        type: 'string',
        maxLength: OutputPolicy.NAME_MAX,
      },
      size: { type: 'integer', minimum: 1, maximum: OutputPolicy.FILE_MAX },
      sha256: {
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
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

/** 러너가 만들기 작업의 재료 결과물 하나를 받기 전에 받는 표. 본문은 이 표로 GET api/outputs/download에서 받는다 */
@Injectable()
export class BeginDownloadTool extends BaseTool {
  readonly name = 'begin_download';
  readonly scope = Actor.RUN;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      output_id: { type: 'string', format: 'uuid' },
    },
    required: ['task_id', 'output_id'],
  };

  constructor(private readonly outputs: OutputQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<DownloadTicketView> {
    return this.outputs.beginDownload(actor, BeginDownloadInput.from(raw));
  }
}
