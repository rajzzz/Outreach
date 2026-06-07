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
  private readonly seniorityFilter: string;
  private readonly maxContactsPerCompany: number;

  constructor(
    private readonly config: ConfigService,
    private readonly retry: RetryUtil,
    private readonly logger: PipelineLogger,
  ) {
    this.apiKey = this.config.getOrThrow<string>('PROSPEO_API_KEY');
    this.baseUrl = this.config.get<string>('PROSPEO_BASE_URL', 'https://api.prospeo.io');

    // Sensible C-suite + VP defaults, overridable via .env
    this.seniorityFilter = this.config.get<string>(
      'PROSPEO_SENIORITY_FILTER',
      'C_SUITE,VP',
    );

    this.maxContactsPerCompany = parseInt(
      this.config.get<string>('MAX_CONTACTS_PER_COMPANY', '3'),
      10,
    );
  }

  /**
   * Stage 2 — Find decision-makers for each company via Prospeo Domain Search.
   *
   * GET /domain-search  ?domain=...&seniority=C_SUITE,VP
   * → { contacts: [{ firstName, lastName, title, linkedin_url }] }
   *
   * Processes companies sequentially to respect rate limits.
   * Per-domain error isolation — one failing domain doesn't crash the run.
   * Caps contacts per company to MAX_CONTACTS_PER_COMPANY.
   */
  async findDecisionMakers(companies: Company[]): Promise<Contact[]> {
    this.logger.info(
      'prospeo',
      `Finding decision-makers for ${companies.length} companies...`,
    );
    this.logger.info('prospeo', `Seniority filter: ${this.seniorityFilter}`);

    const contacts: Contact[] = [];

    for (const company of companies) {
      try {
        const response = await this.retry.withRetry(
          () =>
            axios.get(`${this.baseUrl}/domain-search`, {
              params: {
                domain: company.domain,
                seniority: this.seniorityFilter,
              },
              headers: {
                'X-KEY': this.apiKey,
                'Content-Type': 'application/json',
              },
            }),
          `prospeo.domainSearch[${company.domain}]`,
        );

        const results = response.data.contacts ?? [];

        // Cap contacts per company
        const capped = results.slice(0, this.maxContactsPerCompany);

        for (const person of capped) {
          contacts.push({
            firstName: person.firstName ?? person.first_name ?? '',
            lastName: person.lastName ?? person.last_name ?? '',
            fullName:
              person.fullName ??
              person.full_name ??
              `${person.firstName ?? person.first_name ?? ''} ${person.lastName ?? person.last_name ?? ''}`.trim(),
            title: person.title ?? person.job_title ?? '',
            company: company.name ?? company.domain,
            domain: company.domain,
            linkedinUrl: person.linkedin_url ?? person.linkedinUrl ?? '',
            prospeoPersonId: person.person_id,
          });
        }

        this.logger.success(
          'prospeo',
          `[${company.domain}] ${capped.length}/${this.maxContactsPerCompany} contacts found`,
        );
      } catch (error: any) {
        // Per-domain error isolation — log and continue, don't crash
        this.logger.warn(
          'prospeo',
          `[${company.domain}] Skipped — ${error.message}`,
        );
      }
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
            {
              headers: {
                'X-KEY': this.apiKey,
                'Content-Type': 'application/json',
              },
            },
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
