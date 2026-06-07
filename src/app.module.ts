import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PipelineService } from './pipeline.service';
import { OceanService } from './stages/ocean.service';
import { ProspeoService } from './stages/prospeo.service';
import { BrevoService } from './stages/brevo.service';
import { CheckpointService } from './checkpoint.service';
import { PipelineLogger } from './utils/pipeline.logger';
import { RetryUtil } from './utils/retry.util';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    PipelineService,
    OceanService,
    ProspeoService,
    BrevoService,
    CheckpointService,
    PipelineLogger,
    RetryUtil,
  ],
})
export class AppModule {}
