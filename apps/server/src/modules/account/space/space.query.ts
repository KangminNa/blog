import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, type Blob, BlobStore, Database, NotFound } from '../../platform';
import { spaceMembers, spaces } from '../account.schema';
import { InstallPolicy } from './install.policy';
import { Space } from './space';
import { SpaceRepository } from './space.repository';
import { InstallStatusView, SpaceView } from './space.view';

/** 로고 파일 하나 (누구나 본다: 블로그 머리에 보인다) */
export class LogoFile {
  /** 주소에 내용의 해시(v)가 붙어 바뀌면 주소도 바뀐다. 짧게만 둔다: v 없이 부른 주소가 오래 남지 않게 */
  readonly cacheControl = 'public, max-age=300';

  constructor(
    readonly blob: Blob,
    readonly stream: Readable,
  ) {}
}

// 공간 읽기. 설치됐다 = 주인이 있다.
@Injectable()
export class SpaceQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly install: InstallPolicy,
    private readonly blobs: BlobStore,
  ) {
    super(db);
  }

  async info(_actor: Actor): Promise<SpaceView> {
    const space = await new SpaceRepository(this.sql).current();
    const installed = await this.hasOwner();
    return space?.view(installed) ?? new SpaceView(null, installed);
  }

  /** 사이트 로고 (누구나). 없으면 404: 화면은 Cairn 표시를 그린다 */
  async logo(_actor: Actor): Promise<LogoFile> {
    const row = await this.row(spaces, { slug: Space.SLUG }, { columns: ['logo_blob_hash'] });
    const hash = row?.logo_blob_hash ?? null;
    const blob = hash ? await this.blobs.find(hash) : null;
    if (!hash || !blob) throw new NotFound('로고가 없어요');
    return new LogoFile(blob, await this.blobs.open(hash));
  }

  /** hashes 가운데 로고가 가리키는 파일 (BlobStore.registerUse: 쓰는 동안 platform이 지우지 않게) */
  async usedBlobs(actor: Actor, hashes: readonly string[]): Promise<readonly string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql`
      SELECT logo_blob_hash AS hash FROM account.spaces
      WHERE logo_blob_hash = ANY(${hashes as string[]}::text[])`;
    return rows.map((row) => String(row.hash));
  }

  /** pass: 이 브라우저가 가진 설치 통행증 쿠키 */
  async installStatus(_actor: Actor, pass: string | null): Promise<InstallStatusView> {
    const space = await new SpaceRepository(this.sql).current();
    const spaceId = space?.id ?? null;
    return new InstallStatusView(
      await this.hasOwner(),
      spaceId,
      this.install.isValidPass(pass, spaceId),
    );
  }

  private hasOwner(): Promise<boolean> {
    return this.exists(spaceMembers, { role: 'owner' });
  }
}
