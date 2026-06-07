import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Company, Contact } from '../models';
import { RetryUtil } from '../utils/retry.util';
import { PipelineLogger } from '../utils/pipeline.logger';

interface CachedEmailResult {
  email?: string;
  verified: boolean;
}

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
   * Stage 3 — Resolve each contact's LinkedIn URL to a verified work email
   * via Prospeo's `linkedin-email-finder` endpoint.
   *
   * Credit-conscious by design:
   *   - Sequential calls (no concurrency) so a flood of failures can't burn
   *     credits before the loop notices.
   *   - Deduplicates LinkedIn URLs within the batch — a URL shared by multiple
   *     contacts costs exactly one credit.
   *   - Contacts that already carry a resolved email are passed through
   *     untouched (zero credits spent).
   *   - Failures mark `emailVerified: false` and keep the contact, never
   *     drop it. The checkpoint will surface the gap.
   */
  async resolveEmails(contacts: Contact[]): Promise<Contact[]> {
    this.logger.info(
      'prospeo',
      `Resolving and verifying work email addresses for ${contacts.length} contacts...`,
    );

    // Best-effort credit balance log. Silent if the endpoint shape differs.
    await this.logCreditBalance();

    const cache = new Map<string, CachedEmailResult>();
    const enriched: Contact[] = [];
    let apiCalls = 0;

    for (const contact of contacts) {
      // 1. Skip contacts that already have an email — zero credits spent.
      if (contact.email) {
        enriched.push(contact);
        continue;
      }

      // 2. No LinkedIn URL → can't resolve. Keep the contact, mark unverified.
      const rawUrl = contact.linkedinUrl?.trim();
      if (!rawUrl) {
        this.logger.warn(
          'prospeo',
          `No LinkedIn URL for ${contact.fullName} — skipping enrichment`,
        );
        enriched.push({ ...contact, emailVerified: false });
        continue;
      }

      // 3. Dedupe by normalized URL — reuse the cached result for free.
      const normalizedUrl = this.normalizeLinkedinUrl(rawUrl);
      const cached = cache.get(normalizedUrl);
      if (cached) {
        enriched.push(this.applyEmailResult(contact, cached));
        this.logger.info(
          'prospeo',
          `Reused cached result for ${contact.fullName} (${normalizedUrl})`,
        );
        continue;
      }

      // 4. Sequential API call. Failures are isolated to this contact.
      try {
        const result = await this.findEmailByLinkedin(normalizedUrl);
        apiCalls++;
        cache.set(normalizedUrl, result);
        enriched.push(this.applyEmailResult(contact, result));

        if (result.email) {
          this.logger.success(
            'prospeo',
            `Resolved ${contact.fullName} → ${result.email} (verified: ${result.verified})`,
          );
        } else {
          this.logger.warn(
            'prospeo',
            `Could not find a valid email for ${contact.fullName} at ${contact.domain}`,
          );
        }
      } catch (err: any) {
        // Cache the failure too — retrying the same URL would cost another credit.
        const failed: CachedEmailResult = { verified: false };
        cache.set(normalizedUrl, failed);
        enriched.push(this.applyEmailResult(contact, failed));
        this.logger.error(
          'prospeo',
          `Enrichment failed for ${contact.fullName}: ${err.message}`,
        );
      }
    }

    const successCount = enriched.filter((c) => c.email).length;
    this.logger.success(
      'prospeo',
      `Completed email resolution: ${successCount}/${contacts.length} emails resolved ` +
        `(${apiCalls} API call${apiCalls === 1 ? '' : 's'}, ${cache.size} unique URL${cache.size === 1 ? '' : 's'}).`,
    );
    return enriched;
  }

  private async findEmailByLinkedin(linkedinUrl: string): Promise<CachedEmailResult> {
    const response = await this.retry.withRetry(
      () =>
        axios.post(
          `${this.baseUrl}/linkedin-email-finder`,
          { url: linkedinUrl },
          {
            headers: {
              'X-KEY': this.apiKey,
              'Content-Type': 'application/json',
            },
          },
        ),
      `prospeo.linkedinEmailFinder[${linkedinUrl}]`,
    );

    // Prospeo wraps successful responses in `response`; parse defensively
    // so a shape change doesn't crash the run.
    const data = response.data?.response ?? response.data ?? {};
    const email: string | undefined = data.email;
    const verified =
      data.email_status === 'VERIFIED' ||
      data.email_status === 'verified' ||
      data.email_verified === true;

    return { email, verified };
  }

  private applyEmailResult(contact: Contact, result: CachedEmailResult): Contact {
    if (result.email) {
      return {
        ...contact,
        email: result.email,
        emailVerified: result.verified,
      };
    }
    return { ...contact, emailVerified: false };
  }

  /**
   * Normalize LinkedIn URLs for dedup: trim, lowercase, strip trailing
   * slashes. Keeps protocol + host so we don't accidentally collide
   * different profiles.
   */
  private normalizeLinkedinUrl(url: string): string {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }

  /**
   * Best-effort credit balance probe. Exact shape varies across Prospeo
   * plans, so swallow errors and silently continue rather than failing the
   * run on a missing introspection feature.
   */
  private async logCreditBalance(): Promise<void> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/account-information`,
        {},
        {
          headers: {
            'X-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
        },
      );
      const data = response.data?.response ?? response.data ?? {};
      const balance =
        data.remaining_credits ??
        data.credits ??
        data.balance ??
        data.remaining;
      if (typeof balance === 'number') {
        this.logger.info('prospeo', `Credits remaining: ${balance}`);
      }
    } catch {
      // Endpoint not exposed for this plan or different shape — ignore.
    }
  }
}
