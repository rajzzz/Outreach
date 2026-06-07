import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from '../shared/logger/logger.module';
import { OutreachPipelineService } from './application/outreach-pipeline.service';
import { OceanAdapter } from './infrastructure/adapters/ocean.adapter';
import { ProspeoAdapter } from './infrastructure/adapters/prospeo.adapter';
import { EazyreachAdapter } from './infrastructure/adapters/eazyreach.adapter';
import { BrevoAdapter } from './infrastructure/adapters/brevo.adapter';
import { ConsoleCheckpointAdapter } from './infrastructure/adapters/console-checkpoint.adapter';
import { RetryUtil } from '../shared/retry/retry.util';
import {
  COMPANY_DIRECTORY_PORT,
  CONTACT_FINDER_PORT,
  EMAIL_RESOLVER_PORT,
  OUTREACH_SENDER_PORT,
  CHECKPOINT_PORT,
} from './tokens';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
  ],
  providers: [
    OutreachPipelineService,
    RetryUtil,
    {
      provide: COMPANY_DIRECTORY_PORT,
      useClass: OceanAdapter,
    },
    {
      provide: CONTACT_FINDER_PORT,
      useClass: ProspeoAdapter,
    },
    {
      provide: EMAIL_RESOLVER_PORT,
      useClass: EazyreachAdapter,
    },
    {
      provide: OUTREACH_SENDER_PORT,
      useClass: BrevoAdapter,
    },
    {
      provide: CHECKPOINT_PORT,
      useClass: ConsoleCheckpointAdapter,
    },
  ],
  exports: [OutreachPipelineService],
})
export class OutreachModule {}
