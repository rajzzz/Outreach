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
    this.apiKey = this.config.get<string>('OCEAN_API_KEY')!;
    this.baseUrl = this.config.get<string>('OCEAN_BASE_URL', 'https://api.ocean.io');
    this.pageSize = parseInt(this.config.get<string>('OCEAN_PAGE_SIZE', '50'), 10);
    this.maxCompanies = parseInt(this.config.get<string>('MAX_COMPANIES', '300'), 10);
  }

  /**
   * Stage 1 — Find lookalike companies via Ocean.io.
   *
   * Endpoint: POST /v3/search/companies
   *
   * Request shape (per Ocean.io docs):
   *   {
   *     "size": 10,
   *     "searchAfter": [...],            // optional — array cursor
   *     "companiesFilters": {
   *       "primaryLocations": { "includeCountries": [...] },
   *       "companySizes": ["51-200", ...],
   *       "industries": { "industries": [...] },
   *       "technologies": { "apps": { "anyOf": [...] } }
   *     }
   *   }
   *
   * Response shape:
   *   {
   *     "companies": [{
   *       "domain", "name", "companySize",
   *       "primaryCountry", "industries", "technologies"
   *     }],
   *     "searchAfter": ["<cursor>"],      // cursor for next page — always an ARRAY
   *     "total": <number>
   *   }
   *
   * Lookalike search is driven by companiesFilters.lookalikeDomains using
   * the seed domain. includeDomains / excludeDomains can be added to further
   * filter the result set.
   */
  async findLookalikes(seedDomain: string): Promise<Company[]> {
    this.logger.info('ocean', `Searching for lookalike companies of ${seedDomain}...`);

    const seen = new Set<string>();
    const companies: Company[] = [];
    let searchAfter: any[] | undefined;
    let pageNum = 0;

    do {
      pageNum++;
      const body: Record<string, any> = {
        size: this.pageSize,
        companiesFilters: this.buildFilters(seedDomain),
        fields: ['domain', 'name', 'companySize', 'primaryCountry', 'industries'],
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
            timeout: 10_000, // fail after 10s so retries kick in instead of hanging forever
          }),
        `ocean.searchCompanies[p${pageNum}]`,
      );

      const results = response.data?.companies ?? [];
      const total: number = response.data?.total ?? 0;
      // searchAfter from Ocean.io is an array cursor; pass it back as-is.
      searchAfter = Array.isArray(response.data?.searchAfter) && response.data.searchAfter.length > 0
        ? response.data.searchAfter
        : undefined;

      for (const r of results) {
        // Ocean.io wraps each entry: { company: { domain, name, ... }, relevance }
        const c = r.company ?? r;
        const domain = (c.domain ?? '').toLowerCase().trim();
        if (!domain) continue;
        if (domain === seedDomain.toLowerCase()) continue;
        if (seen.has(domain)) continue;
        seen.add(domain);

        companies.push({
          domain,
          name: c.name,
          industry: Array.isArray(c.industries) ? c.industries[0] : c.industry,
          employeeCount: c.companySize,
          location: c.primaryCountry,
        });

        if (companies.length >= this.maxCompanies) break;
      }

      this.logger.info(
        'ocean',
        `Page ${pageNum} — ${results.length} returned, ${companies.length}/${this.maxCompanies} unique kept (total: ${total})`,
      );
    } while (searchAfter && companies.length < this.maxCompanies);

    this.logger.success(
      'ocean',
      `Found ${companies.length} unique lookalike companies (cap: ${this.maxCompanies}).`,
    );
    return companies;
  }

  /**
   * Build Ocean.io `companiesFilters` for a given seed domain.
   *
   * Currently a broad mid-market ICP — does NOT actually use the seed domain.
   * Replace with seed-attribute extraction (via enrich) or a real lookalike
   * endpoint when wiring the proper similarity behavior.
   */
  private buildFilters(seedDomain: string): Record<string, any> {
    return {
      lookalikeDomains: [seedDomain],
    };
  }
}
