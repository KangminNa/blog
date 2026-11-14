import type { IncomingMessage, ServerResponse } from 'node:http';
import { Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { DeviceQuery } from '../account';
import { type Actor, CurrentActor, McpEndpoint } from '../platform';
import { TaskQuery } from '../task';
import { McpToolbox } from './mcp-toolbox';
import { ToolTextQuery } from './tool-text/tool-text.query';

type McpRequest = IncomingMessage & { body?: unknown };

// AI 도구가 들어오는 입구 (MCP Streamable HTTP). 연결된 기기의 토큰이나 살아 있는 작업의 작업 토큰이 있어야 한다.
// 작업 토큰은 호출마다 작업이 살아 있는지 task에 묻는다: 취소·완료가 바로 듣게 (account는 task를 모른다).
// 도구 응답의 링크에 쓸 사이트 주소도 여기서 읽어 넘긴다 (사이트 주소는 account 모듈의 것).
// 토큰이 없거나 끊긴 기기면 401과 함께 "어디서 인증받으면 되는지"(보호된 자원 안내 주소)를 알려준다 (MCP 인증 규격).
@Controller('mcp')
export class McpController {
  private readonly endpoint: McpEndpoint;

  constructor(
    private readonly devices: DeviceQuery,
    private readonly tasks: TaskQuery,
    toolbox: McpToolbox,
    texts: ToolTextQuery,
  ) {
    this.endpoint = new McpEndpoint(
      'cairn',
      '0.1.0',
      () => toolbox.toolsNow(),
      McpToolbox.INSTRUCTIONS,
      (actor, tools) => texts.describe(actor, tools),
    );
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
    const { siteUrl } = await this.devices.addresses(actor);
    if (actor.kind !== 'device' && !(await this.tasks.isLive(actor))) {
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
    await this.endpoint.handle(actor, siteUrl, req, res, req.body);
  }
}
