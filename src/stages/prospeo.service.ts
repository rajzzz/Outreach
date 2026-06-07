import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Company, Contact } from '../models';
import { RetryUtil } from '../utils/retry.util';
import { PipelineLogger } from '../utils/pipeline.logger';

@Injectable()
export class ProspeoService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly retry: RetryUtil,
    private readonly logger: PipelineLogger,
  ) {
    this.apiKey = this.config.getOrThrow<string>('PROSPEO_API_KEY');
    this.baseUrl = this.config.get<string>('PROSPEO_BASE_URL', 'https://api.prospeo.io');
  }

  private get headers() {
    return {
      'X-KEY': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Stage 2 — Find decision-makers for each company via Prospeo Search Person API.
   *
   * Iterates through each company domain, using page-based pagination
   * (25 results/page, up to 1000 pages). Filters by VP/CXO/Director/Head seniority.
   */
  async findDecisionMakers(companies: Company[]): Promise<Contact[]> {
    this.logger.info(
      'prospeo',
      `Finding decision-makers for ${companies.length} companies...`,
    );

    const contacts: Contact[] = [];

    for (const company of companies) {
      let page = 1;
      let totalPages = 1;

      do {
        const response = await this.retry.withRetry(
          () =>
            axios.post(
              `${this.baseUrl}/search-person`,
              {
                filters: {
                  person_search: company.domain,
                  person_seniority: ['VP', 'CXO', 'Director', 'Head'],
                },
                page,
              },
              { headers: this.headers },
            ),
          `prospeo.search[${company.domain}:p${page}]`,
        );

        const data = response.data;
        totalPages = data.pagination?.total_page ?? 1;

        for (const person of data.results ?? []) {
          contacts.push({
            firstName: person.first_name,
            lastName: person.last_name,
            fullName: person.full_name,
            title: person.job_title,
            company: company.name ?? company.domain,
            domain: company.domain,
            linkedinUrl: person.linkedin_url ?? '',
            prospeoPersonId: person.person_id,
          });
        }

        this.logger.info(
          'prospeo',
          `[${company.domain}] Page ${page}/${totalPages} — ${(data.results ?? []).length} contacts`,
        );

        page++;
      } while (page <= totalPages);
    }

    this.logger.success(
      'prospeo',
      `Found ${contacts.length} decision-makers across ${companies.length} companies.`,
    );
    return contacts;
  }

  /**
   * Stage 3 — Resolve and verify work emails via Prospeo Bulk Enrich Person API.
   *
   * Processes contacts in chunks of 50 (Prospeo's bulk-enrich limit).
   * Only returns verified emails (`only_verified_email: true`).
   */
  async resolveEmails(contacts: Contact[]): Promise<Contact[]> {
    this.logger.info(
      'prospeo',
      `Resolving and verifying work email addresses for ${contacts.length} contacts...`,
    );

    const CHUNK_SIZE = 50;
    const enriched: Contact[] = [];

    for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
      const chunk = contacts.slice(i, i + CHUNK_SIZE);
      const batchNum = Math.floor(i / CHUNK_SIZE) + 1;

      const response = await this.retry.withRetry(
        () =>
          axios.post(
            `${this.baseUrl}/bulk-enrich-person`,
            {
              data: chunk.map((c) => ({ person_id: c.prospeoPersonId })),
              only_verified_email: true,
            },
            { headers: this.headers },
          ),
        `prospeo.bulkEnrich[batch${batchNum}]`,
      );

      const results = response.data.results ?? [];

      for (let j = 0; j < chunk.length; j++) {
        const result = results[j];
        const contact = chunk[j];

        if (result?.email) {
          enriched.push({
            ...contact,
            email: result.email,
            emailVerified: result.email_verified ?? false,
            mobile: result.mobile,
          });
          this.logger.success('prospeo', `Resolved and verified email: ${result.email}`);
        } else {
          this.logger.warn(
            'prospeo',
            `Could not find a valid email for ${contact.fullName} at ${contact.domain}`,
          );
          enriched.push(contact);
        }
      }
    }

    const successCount = enriched.filter((c) => c.email).length;
    this.logger.success(
      'prospeo',
      `Completed email resolution: ${successCount}/${contacts.length} emails resolved.`,
    );
    return enriched;
  }
}
