import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Company } from '../models';
import { RetryUtil } from '../utils/retry.util';
import { PipelineLogger } from '../utils/pipeline.logger';

@Injectable()
export class OceanService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxCompanies: number;

  constructor(
    private readonly config: ConfigService,
    private readonly retry: RetryUtil,
    private readonly logger: PipelineLogger,
  ) {
    this.apiKey = this.config.get<string>('OCEAN_API_KEY')!;
    this.baseUrl = this.config.get<string>('OCEAN_BASE_URL', 'https://api.ocean.io');
    this.maxCompanies = parseInt(this.config.get<string>('MAX_COMPANIES', '10'), 10);
  }

  /**
   * Stage 1 — Find lookalike companies via Ocean.io.
   *
   * POST /companies/lookalike  { domain, limit }
   * → { companies: [{ domain, ... }] }
   *
   * Deduplicates domains and filters out the seed domain itself.
   * Caps results to MAX_COMPANIES.
   */
  async findLookalikes(seedDomain: string): Promise<Company[]> {
    this.logger.info('ocean', `Searching for lookalike companies of ${seedDomain}...`);

    const response = await this.retry.withRetry(
      () =>
        axios.post(
          `${this.baseUrl}/companies/lookalike`,
          { domain: seedDomain, limit: this.maxCompanies },
          {
            headers: {
              'X-Api-Token': this.apiKey,
              'Content-Type': 'application/json',
            },
          },
        ),
      'ocean.findLookalikes',
    );

    const raw = response.data.companies ?? [];
    this.logger.info('ocean', `API returned ${raw.length} results.`);

    // Deduplicate by domain + filter out the seed domain itself
    const seen = new Set<string>();
    const companies: Company[] = [];

    for (const r of raw) {
      const domain = (r.domain ?? '').toLowerCase().trim();
      if (!domain) continue;
      if (domain === seedDomain.toLowerCase()) continue;
      if (seen.has(domain)) continue;
      seen.add(domain);

      companies.push({
        domain,
        name: r.name,
        industry: r.industry,
        employeeCount: r.employeeCount ?? r.employeeRange,
        location: r.location ?? r.hqLocation,
        oceanId: r.id,
        description: r.description,
      });
    }

    // Cap to MAX_COMPANIES after dedup
    const capped = companies.slice(0, this.maxCompanies);

    this.logger.success(
      'ocean',
      `Found ${capped.length} unique lookalike companies (cap: ${this.maxCompanies}).`,
    );
    return capped;
  }
}
