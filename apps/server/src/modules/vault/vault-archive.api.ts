import { Controller, Get, StreamableFile } from '@nestjs/common';
import { type Actor, ArchiveQuery, CurrentActor } from '../platform';

// 백업: 보관 형식 그대로의 zip (주인만). 내려받는 파일이라 JSON 응답이 아니다.
@Controller('api/archive.zip')
export class ArchiveController {
  private static readonly FILE_NAME = 'cairn-archive.zip';

  constructor(private readonly archive: ArchiveQuery) {}

  @Get()
  async download(@CurrentActor() actor: Actor): Promise<StreamableFile> {
    return new StreamableFile(await this.archive.zip(actor), {
      type: 'application/zip',
      disposition: `attachment; filename="${ArchiveController.FILE_NAME}"`,
    });
  }
}
