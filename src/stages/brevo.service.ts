import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Contact, PipelineError } from '../models';
import { RetryUtil } from '../utils/retry.util';
import { PipelineLogger } from '../utils/pipeline.logger';

@Injectable()
export class BrevoService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly senderName: string;
  private readonly senderEmail: string;

  constructor(
    private readonly config: ConfigService,
    private readonly retry: RetryUtil,
    private readonly logger: PipelineLogger,
  ) {
    this.apiKey = this.config.get<string>('BREVO_API_KEY')!;
    this.baseUrl = this.config.get<string>('BREVO_BASE_URL', 'https://api.brevo.com/v3');
    this.senderName = this.config.get<string>('BREVO_SENDER_NAME', 'Raj');
    this.senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL')!;
  }

  /**
   * Stage 4 — Send outreach emails via Brevo transactional API.
   *
   * Sends one email per contact with a verified email address.
   * Throttles to ~2 RPS (500ms delay) to stay under Brevo rate limits.
   * RetryUtil handles 429 / 5xx responses with exponential backoff.
   * Includes per-send error isolation and deduplication by email.
   */
  async sendOutreach(
    contacts: Contact[],
    seedDomain: string,
    errors?: PipelineError[],
  ): Promise<number> {
    // Deduplicate contacts by email address before sending
    const seenEmails = new Set<string>();
    const targets = contacts.filter((c) => {
      if (!c.email || !c.emailVerified) return false;
      const emailLower = c.email.toLowerCase().trim();
      if (seenEmails.has(emailLower)) return false;
      seenEmails.add(emailLower);
      return true;
    });

    this.logger.info('brevo', `Sending outreach emails to ${targets.length} unique contact(s)...`);

    let sentCount = 0;

    for (const contact of targets) {
      // Use firstName, title, company in subject
      const subject = `Quick intro for ${contact.firstName} — ${contact.title} at ${contact.company}`;
      
      const payload = {
        sender: { name: this.senderName, email: this.senderEmail },
        to: [{ email: contact.email!, name: contact.fullName }],
        subject,
        htmlContent: this.buildEmailHtml(contact, seedDomain, this.senderName),
        textContent: this.buildEmailText(contact, seedDomain, this.senderName),
      };

      try {
        await this.retry.withRetry(
          () =>
          axios.post(`${this.baseUrl}/smtp/email`, payload, {
              headers: {
                'api-key': this.apiKey,
                'Content-Type': 'application/json',
              },
              timeout: 10_000,
            }),
          `brevo.send[${contact.email}]`,
        );

        sentCount++;
        this.logger.success(
          'brevo',
          `Outreach email successfully sent to ${contact.fullName} <${contact.email}>`,
        );
      } catch (err: any) {
        // Per-send error isolation — log error and add to collection, continue with other sends
        const errorMsg = err.response?.data?.message ?? err.message;
        this.logger.error(
          'brevo',
          `Failed sending to ${contact.fullName} <${contact.email}>: ${errorMsg}`,
        );
        if (errors) {
          errors.push({
            stage: 'brevo',
            message: `Failed sending to ${contact.fullName}: ${errorMsg}`,
            context: contact.email,
          });
        }
      }

      // Throttle to stay under Brevo rate limits (~2 RPS)
      if (sentCount < targets.length) {
        await this.sleep(500);
      }
    }

    this.logger.success('brevo', `Successfully sent ${sentCount} outreach emails via Brevo.`);
    return sentCount;
  }

  private buildEmailHtml(contact: Contact, seedDomain: string, senderName: string): string {
    return `
<p>Hi ${contact.firstName},</p>
<p>I noticed your work as ${contact.title} at ${contact.company}
and thought there might be a great fit with what we're building at ${seedDomain}.</p>
<p>Would you be open to a quick 15-minute call this week?</p>
<p>Best,<br/>${senderName}</p>
    `.trim();
  }

  private buildEmailText(contact: Contact, seedDomain: string, senderName: string): string {
    return `
Hi ${contact.firstName},

I noticed your work as ${contact.title} at ${contact.company} and thought there might be a great fit with what we're building at ${seedDomain}.

Would you be open to a quick 15-minute call this week?

Best,
${senderName}
    `.trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
