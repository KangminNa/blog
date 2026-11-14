import { createHash } from 'node:crypto';

// AI가 읽는 MCP 도구의 글 (2026-11-14, 2차 1-0): 도구 설명과 입력 칸 설명은 코드에 두지 않는다.
// 모듈마다 설명서 파일(<모듈>.tools.ko.json)이 기본이고, 콘솔에서 쌓은 판이 그 위에 얹힌다 (mcp 모듈).
// 코드(*.tool.ts)는 이름 · 권한 · 입력 모양(형식 · 길이)만 정하고, 여기서 칸마다 설명을 얹어 AI에게 내보낸다.
// 칸 경로: 맨 위 칸은 이름 그대로, 객체 안 칸은 a.b, 배열의 항목은 a[], 배열 항목 안 칸은 a[].b

/** 도구 하나의 글. input은 칸 경로 → 설명 */
export type ToolTextBody = { description: string; input?: Readonly<Record<string, string>> };

/** 글을 얹을 도구 (이름과 입력 모양만 본다) */
type Shaped = { readonly name: string; readonly inputSchema: Readonly<Record<string, unknown>> };

type Schema = {
  properties?: Record<string, Schema>;
  items?: Schema;
  description?: string;
  type?: unknown;
};

export class ToolTexts {
  constructor(private readonly texts: Readonly<Record<string, ToolTextBody>>) {}

  /** 모듈들의 설명서를 합친다. 같은 도구가 두 설명서에 있으면 시작하지 않는다 */
  static of(...catalogs: readonly Readonly<Record<string, ToolTextBody>>[]): ToolTexts {
    const merged: Record<string, ToolTextBody> = {};
    for (const catalog of catalogs)
      for (const [name, text] of Object.entries(catalog)) {
        if (merged[name]) throw new Error(`도구 설명서에 ${name}이(가) 두 번 있어요`);
        merged[name] = text;
      }
    return new ToolTexts(merged);
  }

  /** 입력 모양의 칸 경로 (설명을 얹을 자리) */
  static paths(schema: Readonly<Record<string, unknown>>): string[] {
    return [...ToolTexts.fields(schema).keys()];
  }

  /** 칸 경로 → 형식 (string · integer · array · object …). 콘솔이 칸마다 입력란을 그린다 */
  static types(schema: Readonly<Record<string, unknown>>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, node] of ToolTexts.fields(schema))
      out[path] = typeof node.type === 'string' ? node.type : '';
    return out;
  }

  /** 입력 모양에 이미 적힌 칸 설명 (기능 패키지의 도구는 목록 파일의 글이 모양 안에 있다) */
  static read(schema: Readonly<Record<string, unknown>>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, node] of ToolTexts.fields(schema))
      if (typeof node.description === 'string') out[path] = node.description;
    return out;
  }

  /** 기본 글 위에 고친 글을 얹는다: 설명은 고친 것, 칸 설명은 고친 칸만 (빠진 칸은 기본 글) */
  static merge(base: ToolTextBody, over: ToolTextBody | null): ToolTextBody {
    if (over === null) return base;
    return { description: over.description, input: { ...base.input, ...over.input } };
  }

  /** 글의 해시 (설명 + 칸 경로 순의 칸 설명). 기본 글이 배포로 바뀌었는지 알아보는 데 쓴다 */
  static hash(text: ToolTextBody): string {
    const hash = createHash('sha256').update(`${text.description}\0`);
    const input = Object.entries(text.input ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [path, said] of input) hash.update(`${path}\0${said}\0`);
    return hash.digest('hex');
  }

  /** 글을 얹은 설명과 입력 모양 (원본 모양은 바꾸지 않는다) */
  static apply(
    tool: Shaped,
    text: ToolTextBody | null,
  ): { description: string; inputSchema: Record<string, unknown> } {
    const input = text?.input ?? {};
    const copy = structuredClone(tool.inputSchema) as Record<string, unknown>;
    for (const [path, node] of ToolTexts.fields(copy)) {
      const said = input[path];
      if (said !== undefined) node.description = said;
    }
    return { description: text?.description ?? '', inputSchema: copy };
  }

  /** 이 설명서의 한 도구 글. 없으면 null */
  text(name: string): ToolTextBody | null {
    return this.texts[name] ?? null;
  }

  /** 이 도구의 설명과, 칸마다 설명을 얹은 입력 모양 */
  describe(tool: Shaped): { description: string; inputSchema: Record<string, unknown> } {
    return ToolTexts.apply(tool, this.text(tool.name));
  }

  /** 설명서가 코드와 맞지 않는 곳: 글이 없는 도구 · 글이 없는 칸 · 없는 도구나 칸의 글 */
  problems(tools: readonly Shaped[]): string[] {
    const out: string[] = [];
    const names = new Set(tools.map((t) => t.name));
    for (const tool of tools) {
      const text = this.texts[tool.name];
      if (!text?.description?.trim()) {
        out.push(`${tool.name}: 도구 설명이 없어요`);
        continue;
      }
      const paths = ToolTexts.paths(tool.inputSchema);
      const input = text.input ?? {};
      for (const path of paths)
        if (!input[path]?.trim()) out.push(`${tool.name}.${path}: 칸 설명이 없어요`);
      for (const path of Object.keys(input))
        if (!paths.includes(path)) out.push(`${tool.name}.${path}: 없는 칸의 설명이에요`);
    }
    for (const name of Object.keys(this.texts))
      if (!names.has(name)) out.push(`${name}: 없는 도구의 설명이에요`);
    return out;
  }

  /** 칸 경로 → 그 칸의 모양 (나온 순서대로). 받은 객체를 그대로 가리킨다 (apply는 복사본을 넘긴다) */
  private static fields(schema: Readonly<Record<string, unknown>>): Map<string, Schema> {
    const out = new Map<string, Schema>();
    const walk = (node: Schema | undefined, prefix: string) => {
      for (const [key, child] of Object.entries(node?.properties ?? {})) {
        const path = prefix ? `${prefix}.${key}` : key;
        out.set(path, child);
        walk(child, path);
        if (child.items?.properties) walk(child.items, `${path}[]`);
      }
    };
    walk(schema as Schema, '');
    return out;
  }
}
