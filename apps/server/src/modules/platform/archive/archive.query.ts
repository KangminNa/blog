import { Injectable } from '@nestjs/common';
import { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { ZipFile } from '../base/zip-file';
import { ArchiveFile } from './archive-file';
import type { ArchivePart } from './archive-part';

/** 보관 형식 버전. 형식을 바꾸면 올리고 docs/보관형식.md와 복원 쪽을 함께 고친다 */
const ARCHIVE_FORMAT = 1;

/** 등록된 복원 하나 */
class RestoreStep {
  constructor(
    readonly read: (files: readonly ArchiveFile[]) => ArchivePart,
    readonly after: readonly string[],
  ) {}
}

// Cairn의 내용을 보관 형식 파일 묶음으로 만든다. 맨 위 cairn.json은 여기서, 내용은 각 모듈이 만든다.
// platform은 다른 모듈의 스키마를 모르므로, 내용을 가진 모듈이 onModuleInit에서 자기 파일을 만드는 방법을 등록한다.
//
//   archive.register('vault', (actor) => this.files(actor));
//
// 등록하는 일은 자기 Query의 메서드 하나다. SystemActor(동기화 플러그인)로도 불리므로 공간이 없을 수 있다.
// 비밀값(기기, 토큰, 로그인, 비밀 설정)은 어느 모듈도 파일에 넣지 않는다.
// 복원도 같은 방식이다: 내용을 가진 모듈이 자기 파일을 읽는 방법을 등록한다 (ArchiveRestoreService가 돌린다).
//
//   archive.registerRestore('blog', (files) => PostRestore.read(files), ['vault']);
@Injectable()
export class ArchiveQuery extends BaseQuery {
  /** 앞부분의 `cairn_format` 값 */
  static readonly FORMAT = ARCHIVE_FORMAT;

  private readonly sources = new Map<string, (actor: Actor) => Promise<readonly ArchiveFile[]>>();
  private readonly restores = new Map<string, RestoreStep>();

  register(name: string, files: (actor: Actor) => Promise<readonly ArchiveFile[]>): void {
    if (this.sources.has(name)) throw new Error(`이미 등록된 보관 파일이에요: ${name}`);
    this.sources.set(name, files);
  }

  /** read는 파일 전부를 받아 자기 몫을 읽는다. after: 이 모듈보다 먼저 들여올 모듈들 */
  registerRestore(
    name: string,
    read: (files: readonly ArchiveFile[]) => ArchivePart,
    after: readonly string[] = [],
  ): void {
    if (this.restores.has(name)) throw new Error(`이미 등록된 복원이에요: ${name}`);
    this.restores.set(name, new RestoreStep(read, after));
  }

  /** 등록한 복원을 들여올 순서대로 */
  restoreSteps(): readonly ((files: readonly ArchiveFile[]) => ArchivePart)[] {
    const ordered: string[] = [];
    const visit = (name: string): void => {
      if (ordered.includes(name)) return;
      for (const first of this.restores.get(name)?.after ?? []) visit(first);
      ordered.push(name);
    };
    for (const name of this.restores.keys()) visit(name);
    return ordered.flatMap((name) => this.restores.get(name)?.read ?? []);
  }

  async files(actor: Actor): Promise<readonly ArchiveFile[]> {
    actor.assertCan(Actor.READ_ALL);
    const head = { format: ARCHIVE_FORMAT, generator: 'cairn', spec: 'docs/보관형식.md' };
    const files = [ArchiveFile.text('cairn.json', `${JSON.stringify(head, null, 2)}\n`)];
    for (const read of this.sources.values()) files.push(...(await read(actor)));
    return files;
  }

  /** 백업: 보관 형식 그대로 묶은 zip (주인만). 비공개 내용이 들어 있다 */
  async zip(actor: Actor): Promise<Buffer> {
    actor.assertOwner();
    const zip = new ZipFile();
    for (const file of await this.files(actor)) zip.add(file.path, file.body);
    return zip.toBuffer();
  }
}
