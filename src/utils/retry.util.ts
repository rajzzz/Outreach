import { Injectable } from '@nestjs/common';
import { LogStage, PipelineLogger } from './pipeline.logger';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: any) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  shouldRetry: (error: any) => {
    const status = error?.response?.status;
    // Retry on rate limit (429) and server errors (5xx), not client errors (4xx)
    return status === 429 || (status >= 500 && status < 600) || !status;
  },
};

@Injectable()
export class RetryUtil {
  constructor(private readonly logger: PipelineLogger) {}

  async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    options: RetryOptions = {},
  ): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const stage = this.extractStage(context);
    let lastError: any;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const status = error?.response?.status;
        const shouldRetry = opts.shouldRetry(error);

        if (!shouldRetry || attempt === opts.maxAttempts) {
          this.logger.error(
            stage,
            `[${context}] Failed after ${attempt} attempt(s): ${this.describe(error)}`,
          );
          throw error;
        }

        // Respect Retry-After header if present (rate limits)
        let delayMs = opts.initialDelayMs * Math.pow(2, attempt - 1);
        if (status === 429) {
          const retryAfter = error?.response?.headers?.['retry-after'];
          if (retryAfter) {
            delayMs = parseInt(retryAfter, 10) * 1000;
          }
        }
        delayMs = Math.min(delayMs, opts.maxDelayMs);

        this.logger.warn(
          stage,
          `[${context}] Attempt ${attempt} failed (status: ${status ?? 'network'}). Retrying in ${delayMs}ms...`,
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Extract a LogStage from a context string of the form `<stage>.<operation>`.
   * Falls back to 'pipeline' if the prefix doesn't match a known stage.
   */
  private extractStage(context: string): LogStage {
    const prefix = context.split('.')[0];
    if (
      prefix === 'ocean' ||
      prefix === 'prospeo' ||
      prefix === 'brevo' ||
      prefix === 'checkpoint'
    ) {
      return prefix;
    }
    return 'pipeline';
  }

  /**
   * Build a one-line description of an axios/HTTP error for retry logs.
   */
  private describe(error: any): string {
    const status = error?.response?.status;
    const apiMsg =
      error?.response?.data?.message ??
      error?.response?.data?.error ??
      error?.response?.statusText;
    if (status) {
      return apiMsg ? `${status} ${apiMsg}` : `HTTP ${status}`;
    }
    return error?.message ?? String(error);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
