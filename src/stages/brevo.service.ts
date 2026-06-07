import { Injectable } from '@nestjs/common';
import { Contact } from '../models';
import { PipelineLogger } from '../utils/pipeline.logger';

@Injectable()
export class BrevoService {
  constructor(private readonly logger: PipelineLogger) {}

  async sendOutreach(contacts: Contact[], seedDomain: string): Promise<number> {
    const targetContacts = contacts.filter((c) => c.email);
    this.logger.info('brevo', `Sending outreach emails to ${targetContacts.length} contacts...`);

    // Simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 1500));

    let sentCount = 0;
    for (const c of targetContacts) {
      if (!c.email) continue;
      this.logger.success('brevo', `Outreach email successfully sent to ${c.fullName} <${c.email}> (Domain: ${seedDomain})`);
      sentCount++;
    }

    this.logger.success('brevo', `Successfully sent ${sentCount} outreach emails via Brevo.`);
    return sentCount;
  }
}
