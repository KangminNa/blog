import type { IncomingMessage, ServerResponse } from 'node:http';
import { Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { DeviceQuery } from '../account';
import { type Actor, CurrentActor, McpEndpoint } from '../platform';
import { McpToolbox } from './mcp-toolbox';

type McpRequest = IncomingMessage & { body?: unknown };

// AI 도구가 들어오는 입구 (MCP Streamable HTTP). 연결된 기기의 토큰이 있어야 한다.
// 토큰이 없거나 끊긴 기기면 401과 함께 "어디서 인증받으면 되는지"(보호된 자원 안내 주소)를 알려준다 (MCP 인증 규격).
@Controller('mcp')
export class McpController {
  private readonly endpoint: McpEndpoint;

  constructor(
    private readonly devices: DeviceQuery,
    toolbox: McpToolbox,
  ) {
    this.endpoint = new McpEndpoint('cairn', '0.1.0', toolbox.tools);
  }

  @Post()
  post(@CurrentActor() actor: Actor, @Req() req: McpRequest, @Res() res: ServerResponse) {
    return this.handle(actor, req, res);
  }

  @Get()
  get(@CurrentActor() actor: Actor, @Req() req: McpRequest, @Res() res: ServerResponse) {
    return this.handle(actor, req, res);
  }

  @Delete()
  remove(@CurrentActor() actor: Actor, @Req() req: McpRequest, @Res() res: ServerResponse) {
    return this.handle(actor, req, res);
  }

  private async handle(actor: Actor, req: McpRequest, res: ServerResponse): Promise<void> {
    if (actor.kind !== 'device') {
      const { siteUrl } = await this.devices.addresses(actor);
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': `Bearer resource_metadata="${siteUrl}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end(
        JSON.stringify({
          code: 'unauthenticated',
          message: '연결된 기기의 토큰이 필요해요. AI 도구에서 이 MCP 서버에 로그인해 주세요',
        }),
      );
      return;
    }
    await this.endpoint.handle(actor, req, res, req.body);
  }
}
