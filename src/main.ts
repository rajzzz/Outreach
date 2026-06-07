import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { OutreachModule } from './outreach/outreach.module';
import { OutreachPipelineService } from './outreach/application/outreach-pipeline.service';

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
  const app = await NestFactory.createApplicationContext(OutreachModule, {
    logger: false, // silence NestJS internal logs
  });

  const pipeline = app.get(OutreachPipelineService);

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
