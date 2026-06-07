import { ConfigService } from '@nestjs/config';

/**
 * Fail-fast validation: ensures all required environment variables
 * are present before the pipeline starts making API calls.
 */
export function validateConfig(config: ConfigService): void {
  const required = [
    'OCEAN_API_KEY',
    'PROSPEO_API_KEY',
    'BREVO_API_KEY',
    'BREVO_SENDER_EMAIL',
  ];

  const missing = required.filter((key) => !config.get(key));

  if (missing.length) {
    throw new Error(
      `\n  Missing required environment variables:\n` +
        missing.map((k) => `    • ${k}`).join('\n') +
        `\n\n  Copy .env.example → .env and fill in your API keys.\n`,
    );
  }
}
