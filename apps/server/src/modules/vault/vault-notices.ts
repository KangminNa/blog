import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NoticeCatalog, NoticeKind } from '../platform';
import { StaleWikis } from './wiki-score/stale-wikis';

// vault가 알리는 것 (7단계). 모두 묶음: 하나씩 바로 알릴 만큼 급하지 않고, 같은 묶음 키라 읽기 전까지 한 줄로 바뀐다.
//   검토할 제안: AI의 변경 묶음이 승인함에서 기다림
//   세션 들어옴: 새 세션이 저장됨 (같은 대화의 새 판은 알리지 않는다)
//   지울 만한 위키: WikiStaleJob이 바로 남긴다 (StaleWikis)
@Injectable()
export class VaultNotices implements OnModuleInit {
  static readonly CHANGE_REVIEW = 'vault.change.review';
  static readonly SESSION_SAVED = 'vault.session.saved';

  constructor(private readonly catalog: NoticeCatalog) {}

  onModuleInit(): void {
    this.catalog.define(
      new NoticeKind(VaultNotices.CHANGE_REVIEW, '검토할 제안', NoticeKind.DIGEST).from(
        ['vault.change.submitted'],
        (e) =>
          e.data.status !== 'review'
            ? null
            : {
                title: '승인함에 검토할 제안이 있어요',
                body: null,
                link: '/admin/approvals',
                group_key: 'change-review',
                data: { changeSetId: e.data.changeSetId },
              },
      ),
    );
    this.catalog.define(
      new NoticeKind(VaultNotices.SESSION_SAVED, '세션 들어옴', NoticeKind.DIGEST).from(
        ['vault.session.saved'],
        (e) =>
          e.data.created !== true
            ? null
            : {
                title: '새 세션이 들어왔어요',
                body: typeof e.data.project === 'string' ? e.data.project : null,
                link: `/admin/sessions?session=${e.data.sessionId}`,
                group_key: 'session-saved',
                data: { sessionId: e.data.sessionId },
              },
      ),
    );
    this.catalog.define(new NoticeKind(StaleWikis.NOTICE, '지울 만한 위키', NoticeKind.DIGEST));
  }
}
