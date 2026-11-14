import '../_blog/blog.css';
import { renderMarkdown } from '../_lib/markdown';

/** AI가 쓴 md 글 (작업의 결과, 대화의 답). 본문의 HTML은 그리지 않고 결과도 거른다 (_lib/markdown.ts) */
export function MarkdownText({ text }: { text: string }) {
  return (
    <div
      className="prose"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown이 거른 HTML
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
