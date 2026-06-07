import { Injectable, Logger } from '@nestjs/common';

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
  private readonly logger = new Logger(RetryUtil.name);

  async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    options: RetryOptions = {},
  ): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
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
            `[${context}] Failed after ${attempt} attempt(s): ${error.message}`,
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
          `[${context}] Attempt ${attempt} failed (status: ${status ?? 'network'}). Retrying in ${delayMs}ms...`,
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
