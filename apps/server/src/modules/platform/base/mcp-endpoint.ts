import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Actor } from './actor';
import type { BaseTool } from './base-tool';
import { Database } from './database';
import { DomainError, Forbidden } from './errors';

// MCP 입구. MCP SDK를 가져오는 유일한 파일이다 (외부 라이브러리는 platform/base 안에서만, 객체설계 10장).
// 요청마다 서버를 새로 만드는 상태 없는 방식이라, 서버를 여러 개 띄워도 그대로 동작한다.
// 도구는 BaseTool만 알면 되고, 오류는 DomainError.toJSON()으로 AI가 고칠 수 있게 돌려준다.
export class McpEndpoint {
  constructor(
    private readonly name: string,
    private readonly version: string,
    /** 지금 열린 도구들. 요청마다 묻는다: 기능 패키지를 켜고 끄면 재시작 없이 도구가 바뀐다 */
    private readonly toolsNow: () => readonly BaseTool[],
    /** AI 도구가 서버에 붙을 때 받는 안내 (스킬이 없는 도구도 이것만 보고 쓸 수 있게) */
    private readonly instructions: string,
  ) {}

  /** 인증된 요청자(기기) 하나의 HTTP 요청 하나 (POST·GET·DELETE /mcp). site: 블로그의 사이트 주소 */
  async handle(
    actor: Actor,
    site: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const server = new Server(
      { name: this.name, version: this.version },
      { capabilities: { tools: {} }, instructions: this.instructions },
    );
    const tools = this.toolsNow();
    const visible = tools.filter((t) => t.allows(actor));
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: visible.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object' as const, ...t.inputSchema },
        annotations: {
          readOnlyHint: t.readOnly,
          destructiveHint: t.destructive,
          idempotentHint: t.idempotent,
          openWorldHint: false,
        },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.find((t) => t.name === request.params.name);
      try {
        if (!tool) throw new Forbidden('tool', `${request.params.name} 도구가 없어요`);
        if (!tool.allows(actor)) throw new Forbidden(tool.scope);
        const result = (await tool.handle(actor, request.params.arguments ?? {}, site)).toJSON();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        // DB 시간 제한에 걸린 오류는 busy로 알린다 (러너는 busy를 받으면 같은 요청을 다시 보낸다)
        const known = error instanceof DomainError ? error : Database.busy(error);
        if (!known) throw error;
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(known.toJSON()) }],
        };
      }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
