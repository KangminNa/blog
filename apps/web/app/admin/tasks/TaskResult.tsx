import '../../_blog/blog.css';
import { renderMarkdown } from '../../_lib/markdown';

/**
 * 작업의 결과. 러너가 낸 글(result.text)은 md로 읽히게 그린다 (본문의 HTML은 그리지 않고 결과도 거른다, _lib/markdown.ts).
 * 실패 이유는 따로, 그 밖의 칸(형식이 정해지지 않은 것)만 접어서 그대로 보인다
 */
export function TaskResult({ result }: { result: unknown }) {
  if (typeof result !== 'object' || result === null || Object.keys(result).length === 0)
    return null;
  const { error, text, ...rest } = result as Record<string, unknown>;
  const other = typeof text === 'string' || text === undefined ? rest : { text, ...rest };
  return (
    <section className="panel" aria-labelledby="task-result">
      <h2 id="task-result">결과</h2>
      {typeof error === 'string' && <p className="error">{error}</p>}
      {typeof text === 'string' && text.trim() !== '' && (
        <div
          className="prose"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown이 거른 HTML
          dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
        />
      )}
      {Object.keys(other).length > 0 && (
        <details>
          <summary className="note">그 밖의 칸</summary>
          <pre className="raw">{JSON.stringify(other, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
