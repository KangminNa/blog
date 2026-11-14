import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  type Actor,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
  type HttpUpload,
} from '../../platform';
import { DownloadTicket } from './download-ticket';
import {
  ListOutputsInput,
  OutputActionInput,
  OutputFileInput,
  UploadOutputInput,
} from './output.input';
import { OutputFile, OutputQuery } from './output.query';
import { OutputService } from './output.service';
import type { OutputPageView, OutputSavedView } from './output.view';
import { UploadTicket } from './upload-ticket';

// 콘솔 "결과물" 메뉴와 러너의 결과물 올리기 (기획서 결정 2026-11-10).
// 읽기 · 지우기는 주인만. 올리기는 로그인이 아니라 begin_upload로 받은 표(머리글)로만: 기기 토큰은 /mcp에서만 통한다.
// 만들기 작업의 재료 내려받기도 같다: begin_download로 받은 표(머리글)로만.
@Controller('api/outputs')
export class OutputController {
  constructor(
    private readonly query: OutputQuery,
    private readonly service: OutputService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<OutputPageView> {
    return this.query.list(actor, ListOutputsInput.from(query));
  }

  /** 파일. 늘 내려받기, ?inline=1이면 미리 보기 (열어도 되는 형식만) */
  @Get(':id/file')
  async file(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const file = await this.query.file(actor, OutputFileInput.from(id, query));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', file.csp);
    return new StreamableFile(file.stream, {
      type: file.mime,
      disposition: file.disposition,
      length: file.size,
    });
  }

  /** 러너: 만들기 작업의 재료 결과물 하나. 머리글 x-cairn-download에 begin_download의 표 (로그인 없음) */
  @Get('download')
  async download(
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const token = req.headers[DownloadTicket.HEADER];
    const file = await this.query.download(typeof token === 'string' ? token : null);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', OutputFile.CSP);
    return new StreamableFile(file.stream, {
      type: file.mime,
      disposition: file.disposition,
      length: file.size,
    });
  }

  /** 러너: 본문이 파일 그대로. 머리글 x-cairn-upload에 begin_upload의 표 */
  @Put('upload')
  async upload(@Req() req: HttpUpload): Promise<OutputSavedView> {
    const token = req.headers[UploadTicket.HEADER];
    const length = Number(req.headers['content-length']);
    const output = await this.service.receive(
      typeof token === 'string' ? token : null,
      req,
      Number.isSafeInteger(length) ? length : null,
    );
    return output.view();
  }

  /** 주인: 파일 하나 올리기 (재료로). ?name=<이름>, 본문은 파일 그대로 (application/octet-stream) */
  @HttpCode(201)
  @Post('files')
  async uploadMine(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
    @Req() req: HttpUpload,
  ): Promise<OutputSavedView> {
    const length = Number(req.headers['content-length']);
    const output = await this.service.upload(
      actor,
      UploadOutputInput.from(query),
      req,
      Number.isSafeInteger(length) ? length : null,
    );
    return output.view();
  }

  @HttpCode(200)
  @Post(':id/delete')
  async trash(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OutputSavedView> {
    return (await this.service.trash(actor, OutputActionInput.from(id, body))).view();
  }

  @HttpCode(200)
  @Post(':id/restore')
  async untrash(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OutputSavedView> {
    return (await this.service.untrash(actor, OutputActionInput.from(id, body))).view();
  }

  /** 휴지통에서 바로 지우기 */
  @HttpCode(204)
  @Post(':id/purge')
  async purge(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.service.purge(actor, OutputActionInput.from(id, body));
  }
}
