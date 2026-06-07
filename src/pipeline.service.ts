import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OceanService } from './stages/ocean.service';
import { ProspeoService } from './stages/prospeo.service';
import { BrevoService } from './stages/brevo.service';
import { CheckpointService } from './checkpoint.service';
import { PipelineLogger } from './utils/pipeline.logger';
import { Company, Contact, PipelineResult } from './models';

@Injectable()
export class PipelineService {
  private readonly isDryRun: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly ocean: OceanService,
    private readonly prospeo: ProspeoService,
    private readonly brevo: BrevoService,
    private readonly checkpoint: CheckpointService,
    private readonly logger: PipelineLogger,
  ) {
    this.isDryRun = this.config.get<string>('DRY_RUN', 'true') === 'true';
  }

  async run(seedDomain: string): Promise<PipelineResult> {
    const startedAt = Date.now();
    const errors: PipelineResult['errors'] = [];

    this.logger.banner(seedDomain);

    // ── Stage 1: find lookalike companies ──────────────────────────────
    this.logger.divider();
    const companies: Company[] = await this.ocean.findLookalikes(seedDomain).catch((err) => {
      errors.push({ stage: 'ocean', message: err.message });
      return [];
    });

    if (!companies.length) {
      this.logger.error('pipeline', 'No companies returned from Ocean.io. Aborting.');
      return this.buildResult(seedDomain, 0, 0, 0, 0, errors, startedAt);
    }

    // ── Stage 2: find decision-makers ──────────────────────────────────
    this.logger.divider();
    const contacts: Contact[] = await this.prospeo.findDecisionMakers(companies).catch((err) => {
      errors.push({ stage: 'prospeo', message: err.message });
      return [];
    });

    if (!contacts.length) {
      this.logger.error('pipeline', 'No contacts returned from Prospeo. Aborting.');
      return this.buildResult(seedDomain, companies.length, 0, 0, 0, errors, startedAt);
    }

    // ── Stage 3: resolve work emails (also handled by Prospeo) ──────────
    this.logger.divider();
    const enriched: Contact[] = await this.prospeo.resolveEmails(contacts).catch((err) => {
      errors.push({ stage: 'prospeo', message: err.message });
      return contacts; // proceed with unresolved — checkpoint will show the gap
    });

    const emailsResolved = enriched.filter((c) => c.email && c.emailVerified).length;

    // ── Safety checkpoint ──────────────────────────────────────────────
    const confirmed = await this.checkpoint.confirm(enriched);

    if (!confirmed) {
      this.logger.warn('pipeline', 'Aborted by user at checkpoint. No emails sent.');
      return this.buildResult(
        seedDomain,
        companies.length,
        contacts.length,
        emailsResolved,
        0,
        errors,
        startedAt,
      );
    }

    // ── Stage 4: send outreach ─────────────────────────────────────────
    this.logger.divider();
    let sent = 0;

    if (this.isDryRun) {
      this.logger.warn('pipeline', 'DRY_RUN=true — skipping Brevo send stage.');
    } else {
      sent = await this.brevo.sendOutreach(enriched, seedDomain).catch((err) => {
        errors.push({ stage: 'brevo', message: err.message });
        return 0;
      });
    }

    // ── Final summary ──────────────────────────────────────────────────
    const result = this.buildResult(
      seedDomain,
      companies.length,
      contacts.length,
      emailsResolved,
      sent,
      errors,
      startedAt,
    );

    this.logger.divider();
    this.printSummary(result);
    return result;
  }

  private buildResult(
    seedDomain: string,
    companiesFound: number,
    contactsFound: number,
    emailsResolved: number,
    emailsSent: number,
    errors: PipelineResult['errors'],
    startedAt: number,
  ): PipelineResult {
    return {
      seedDomain,
      companiesFound,
      contactsFound,
      emailsResolved,
      emailsSent,
      errors,
      durationMs: Date.now() - startedAt,
    };
  }

  private printSummary(result: PipelineResult): void {
    const s = (n: number, label: string) =>
      `${String(n).padStart(4)}  ${label}`;

    console.log('');
    console.log('  Run complete');
    console.log('');
    console.log(s(result.companiesFound,  'lookalike companies found'));
    console.log(s(result.contactsFound,   'decision-makers found'));
    console.log(s(result.emailsResolved,  'emails resolved'));
    console.log(s(result.emailsSent,      'emails sent'));
    if (result.errors.length) {
      console.log(s(result.errors.length, 'errors (see above)'));
    }
    console.log('');
    console.log(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log('');
  }
}
