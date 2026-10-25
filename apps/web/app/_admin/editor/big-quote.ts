import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bigQuote: {
      /** 고른 문단을 큰 인용으로 감싸거나 풀기 */
      toggleBigQuote: () => ReturnType;
    };
  }
}

// 큰 인용 (md: > [!quote]). 가운데에 크게 보이는 인용이라 일반 인용(blockquote)보다 먼저 읽는다.
export const BigQuote = Node.create({
  name: 'bigQuote',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  parseHTML() {
    return [{ tag: 'blockquote.md-quote', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['blockquote', mergeAttributes(HTMLAttributes, { class: 'md-quote' }), 0];
  },

  addCommands() {
    return {
      toggleBigQuote:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },
});
