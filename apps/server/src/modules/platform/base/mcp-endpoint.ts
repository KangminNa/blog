import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Actor } from './actor';
import type { BaseTool } from './base-tool';
import { DomainError, Forbidden } from './errors';

// MCP 입구. MCP SDK를 가져오는 유일한 파일이다 (2026-10-10 결정: SDK는 platform/base 안에서만).
// 요청마다 서버를 새로 만드는 상태 없는 방식이라, 서버를 여러 개 띄워도 그대로 동작한다.
// 도구는 BaseTool만 알면 되고, 오류는 DomainError.toJSON()으로 AI가 고칠 수 있게 돌려준다.
export class McpEndpoint {
  constructor(
    private readonly name: string,
    private readonly version: string,
    private readonly tools: readonly BaseTool[],
  ) {}

  /** 인증된 요청자(기기) 하나의 HTTP 요청 하나 (POST·GET·DELETE /mcp) */
  async handle(
    actor: Actor,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const server = new Server(
      { name: this.name, version: this.version },
      { capabilities: { tools: {} } },
    );
    const visible = this.tools.filter((t) => actor.can(t.scope));
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: visible.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object' as const, ...t.inputSchema },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.tools.find((t) => t.name === request.params.name);
      try {
        if (!tool) throw new Forbidden('tool', `${request.params.name} 도구가 없어요`);
        actor.assertCan(tool.scope);
        const result = (await tool.handle(actor, request.params.arguments ?? {})).toJSON();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(error.toJSON()) }],
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
