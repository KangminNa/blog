import { Injectable } from '@nestjs/common';
import { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { ArchiveFile } from './archive-file';

/** 보관 형식 버전. 형식을 바꾸면 올리고 docs/보관형식.md와 복원 쪽을 함께 고친다 */
export const ARCHIVE_FORMAT = 1;

// Cairn의 내용을 보관 형식 파일 묶음으로 만든다.
// 지금은 맨 위 cairn.json뿐이다. 각 모듈이 데이터를 만들면서 자기 파일을 더한다
// (M1 세션·사진, M2·M3 카테고리·wiki·선, M4 글).
@Injectable()
export class ArchiveQuery extends BaseQuery {
  async files(actor: Actor): Promise<readonly ArchiveFile[]> {
    actor.assertCan(Actor.READ_ALL);
    const head = { format: ARCHIVE_FORMAT, generator: 'cairn', spec: 'docs/보관형식.md' };
    return [ArchiveFile.text('cairn.json', `${JSON.stringify(head, null, 2)}\n`)];
  }
}
