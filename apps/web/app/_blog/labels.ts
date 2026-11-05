import type { PostStatus } from './types';

// 글의 화면 이름

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: '초안',
  published: '공개',
  unlisted: '링크 공개',
};
