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

  // Fail-fast if required env vars are missing
  const config = app.get(ConfigService);
  validateConfig(config);

  const pipeline = app.get(PipelineService);

  try {
    await pipeline.run(seedDomain);
  } catch (err: any) {
    console.error(`\n  Fatal error: ${err.message}\n`);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
