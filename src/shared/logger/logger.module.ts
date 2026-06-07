import { Global, Module } from '@nestjs/common';
import { PipelineLoggerAdapter } from './pipeline-logger.adapter';
import { LOGGER_PORT } from './logger.port';

@Global()
@Module({
  providers: [
    {
      provide: LOGGER_PORT,
      useClass: PipelineLoggerAdapter,
    },
  ],
  exports: [LOGGER_PORT],
})
export class LoggerModule {}
