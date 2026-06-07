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
  private readonly pageSize: number;
  private readonly maxCompanies: number;

  constructor(
    private readonly config: ConfigService,
    private readonly retry: RetryUtil,
    private readonly logger: PipelineLogger,
  ) {
    this.apiKey = this.config.getOrThrow<string>('OCEAN_API_KEY');
    this.baseUrl = this.config.get<string>('OCEAN_BASE_URL', 'https://api.ocean.io');
    this.pageSize = parseInt(this.config.get<string>('OCEAN_PAGE_SIZE', '50'), 10);
    this.maxCompanies = parseInt(this.config.get<string>('MAX_COMPANIES', '10'), 10);
  }

  /**
   * Stage 1 — Find lookalike companies via Ocean.io.
   *
   * Uses cursor-based pagination (`searchAfter`). Each page returns up to
   * `pageSize` results. Stops when the API stops returning a cursor
   * or when `MAX_COMPANIES` is reached.
   */
  async findLookalikes(seedDomain: string): Promise<Company[]> {
    this.logger.info('ocean', `Searching for lookalike companies of ${seedDomain}...`);

    const allCompanies: Company[] = [];
    let searchAfter: string | undefined;

    do {
      const body: Record<string, any> = {
        size: this.pageSize,
        companiesFilters: {
          similarTo: [seedDomain],
        },
      };
      if (searchAfter) {
        body.searchAfter = searchAfter;
      }

      const response = await this.retry.withRetry(
        () =>
          axios.post(`${this.baseUrl}/v3/search/companies`, body, {
            headers: {
              'X-Api-Token': this.apiKey,
              'Content-Type': 'application/json',
            },
          }),
        'ocean.findLookalikes',
      );

      const results = response.data.results ?? [];
      searchAfter = response.data.searchAfter ?? undefined;

      for (const r of results) {
        allCompanies.push({
          domain: r.domain,
          name: r.name,
          industry: r.industry,
          employeeCount: r.employeeRange,
          location: r.hqLocation,
          oceanId: r.id,
          description: r.description,
        });
      }

      this.logger.info(
        'ocean',
        `Fetched page — ${results.length} results (total: ${allCompanies.length})`,
      );
    } while (searchAfter && allCompanies.length < this.maxCompanies);

    // Trim to exact cap if the last page pushed us over
    const capped = allCompanies.slice(0, this.maxCompanies);

    this.logger.success('ocean', `Found ${capped.length} lookalike companies (cap: ${this.maxCompanies}).`);
    return capped;
  }
}
