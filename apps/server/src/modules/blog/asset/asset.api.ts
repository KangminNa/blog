import { Body, Controller, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import {
  type Actor,
  BaseResponse,
  type Blob,
  CurrentActor,
  type HttpResponse,
} from '../../platform';
import { UploadAssetInput } from './asset.input';
import { AssetQuery } from './asset.query';
import { AssetService } from './asset.service';
import { AssetView } from './asset.view';

/** 올린 사진 하나 */
export class AssetResponse extends BaseResponse {
  private constructor(private readonly blob: Blob) {
    super();
  }

  static of(blob: Blob): AssetResponse {
    return new AssetResponse(blob);
  }

  toJSON(): object {
    return new AssetView(this.blob.hash, this.blob.mime, this.blob.size).toJSON();
  }
}

// 글에 사진 올리기. 본문은 파일 그대로다 (HttpSetup이 image/*를 10MB까지 받는다). 주인만.
@Controller('api/posts/:id/assets')
export class AssetController {
  constructor(private readonly service: AssetService) {}

  @Post()
  async upload(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AssetResponse> {
    const input = UploadAssetInput.from(id, body);
    return AssetResponse.of(
      await this.service.upload(actor, input.postId, input.bytes, input.mime),
    );
  }
}

// 파일 내보내기. 저장한 형식 그대로 보내고, 브라우저가 형식을 짐작하지 못하게 한다.
@Controller('api/files')
export class FileController {
  constructor(private readonly assets: AssetQuery) {}

  @Get(':hash')
  async read(
    @CurrentActor() actor: Actor,
    @Param('hash') hash: string,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const file = await this.assets.file(actor, hash);
    res.setHeader('Cache-Control', file.cacheControl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.stream, {
      type: file.blob.mime,
      disposition: 'inline',
      length: file.blob.size,
    });
  }
}
