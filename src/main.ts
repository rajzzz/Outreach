import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { PipelineService } from './pipeline.service';
import { validateConfig } from './config.validation';

async function bootstrap() {
  const seedDomain = process.argv[2];

  if (!seedDomain) {
    console.error('\n  Usage: npm start <domain>\n  Example: npm start stripe.com\n');
    process.exit(1);
  }

  // Validate it looks like a domain
  const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
  if (!domainPattern.test(seedDomain)) {
    console.error(`\n  Invalid domain: "${seedDomain}"\n  Expected format: company.com\n`);
    process.exit(1);
  }

  // Boot NestJS app context (no HTTP server)
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false, // silence NestJS internal logs
  });

  // Graceful Ctrl+C / SIGTERM: close Nest context, then exit cleanly.
  let interrupted = false;
  const handleInterrupt = async (signal: string) => {
    if (interrupted) return;
    interrupted = true;
    console.error(`\n\n  ${signal} received — shutting down cleanly...\n`);
    try {
      await app.close();
    } catch {
      /* swallow shutdown errors — we're already exiting */
    }
    process.exit(130); // 128 + SIGINT(2)
  };
  process.on('SIGINT', () => handleInterrupt('SIGINT'));
  process.on('SIGTERM', () => handleInterrupt('SIGTERM'));

  // Fail-fast if required env vars are missing
  const config = app.get(ConfigService);
  validateConfig(config);

  const pipeline = app.get(PipelineService);

  try {
    await pipeline.run(seedDomain);
  } catch (err: any) {
    console.error(`\n  Fatal error: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Catch any rejection that escapes the bootstrap chain so the user always
// sees a clean error message instead of Node's default unhandled-rejection trace.
process.on('unhandledRejection', (reason: any) => {
  console.error(`\n  Unhandled rejection: ${reason?.message ?? reason}\n`);
  process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
  console.error(`\n  Uncaught exception: ${err.message}\n`);
  process.exit(1);
});

bootstrap().catch((err: any) => {
  console.error(`\n  Fatal error during bootstrap: ${err.message}\n`);
  process.exit(1);
});
