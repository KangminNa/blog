import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PasswordHasher, SecretBox } from '../platform';
import { DeviceController } from './device/device.controller';
import { DeviceQuery } from './device/device.query';
import { DeviceService } from './device/device.service';
import { OAuthController } from './device/oauth.controller';
import { ActorGuard } from './guard/actor.guard';
import { ExternalLoginController } from './owner/external-login.controller';
import { ExternalLoginQuery } from './owner/external-login.query';
import { LoginController } from './owner/login.controller';
import { OwnerQuery } from './owner/owner.query';
import { OwnerService } from './owner/owner.service';
import { PasswordPolicy } from './owner/password.policy';
import { InstallController } from './space/install.controller';
import { InstallPolicy } from './space/install.policy';
import { SpaceController } from './space/space.controller';
import { SpaceQuery } from './space/space.query';
import { SpaceService } from './space/space.service';

// 블로그 공간, 주인(아이디·비밀번호 로그인 + 로그인 플러그인으로 연결한 외부 계정), 기기(MCP OAuth). 모든 요청의 요청자는 여기의 Guard가 정한다.
@Module({
  providers: [
    {
      provide: InstallPolicy,
      useFactory: (box: SecretBox) => new InstallPolicy(box),
      inject: [SecretBox],
    },
    { provide: PasswordHasher, useValue: new PasswordHasher() },
    { provide: PasswordPolicy, useValue: new PasswordPolicy() },
    SpaceQuery,
    SpaceService,
    OwnerQuery,
    ExternalLoginQuery,
    OwnerService,
    DeviceQuery,
    DeviceService,
    { provide: APP_GUARD, useClass: ActorGuard },
  ],
  controllers: [
    InstallController,
    SpaceController,
    LoginController,
    ExternalLoginController,
    OAuthController,
    DeviceController,
  ],
  exports: [InstallPolicy, SpaceQuery, OwnerService, DeviceQuery],
})
export class AccountModule {}
