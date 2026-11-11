import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NoticeCatalog, NoticeKind } from '../platform';

// account가 알리는 것 (7단계): 새 기기 연결(즉시). 모르는 기기가 붙었으면 바로 알아야 한다 (기획서 6.2).
@Injectable()
export class AccountNotices implements OnModuleInit {
  static readonly DEVICE_CONNECTED = 'account.device.connected';

  constructor(private readonly catalog: NoticeCatalog) {}

  onModuleInit(): void {
    this.catalog.define(
      new NoticeKind(AccountNotices.DEVICE_CONNECTED, '새 기기 연결', NoticeKind.IMMEDIATE).from(
        ['account.device.connected'],
        (e) => ({
          title: '새 기기를 연결했어요',
          body: [e.data.name, e.data.client]
            .filter((v) => typeof v === 'string' && v !== '')
            .join(' · '),
          link: '/admin/devices',
          group_key: `device:${e.data.deviceId}`,
          data: { deviceId: e.data.deviceId },
        }),
      ),
    );
  }
}
