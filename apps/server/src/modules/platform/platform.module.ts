import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import postgres from 'postgres';
import { HealthController } from './health.controller';
import { SQL, type Sql } from './sql';

@Injectable()
class SqlLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async onApplicationShutdown() {
    await this.sql.end({ timeout: 5 });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SQL,
      useFactory: (): Sql => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is not set');
        return postgres(url, { max: 10 });
      },
    },
    SqlLifecycle,
  ],
  controllers: [HealthController],
  exports: [SQL],
})
export class PlatformModule {}
