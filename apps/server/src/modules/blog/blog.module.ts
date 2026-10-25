import { Module } from '@nestjs/common';
import { PostController } from './post/post.controller';
import { PostQuery } from './post/post.query';
import { PostService } from './post/post.service';

// 방문자가 읽는 블로그. 지금은 글(쓰기·고치기·공개 범위·휴지통)과 방문자의 글 목록·글 페이지.
@Module({
  providers: [PostService, PostQuery],
  controllers: [PostController],
})
export class BlogModule {}
