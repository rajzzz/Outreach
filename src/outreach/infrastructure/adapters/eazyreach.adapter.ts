import { Inject, Injectable } from '@nestjs/common';
import { Contact } from '../../domain/models/outreach.models';
import { EmailResolver } from '../../domain/ports/email-resolver.port';
import { LoggerPort, LOGGER_PORT } from '../../../shared/logger/logger.port';

@Injectable()
export class EazyreachAdapter implements EmailResolver {
  constructor(
    @Inject(LOGGER_PORT)
    private readonly logger: LoggerPort,
  ) {}

  async resolveEmails(contacts: Contact[]): Promise<Contact[]> {
    this.logger.info('eazyreach', `Resolving and verifying work email addresses for ${contacts.length} contacts...`);

    // Simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const resolved = contacts.map((c) => {
      if (c.firstName.toLowerCase() === 'david') {
        this.logger.warn('eazyreach', `Could not find a valid email pattern for ${c.fullName} at ${c.domain}`);
        return c;
      }

      const email = `${c.firstName.toLowerCase()}.${c.lastName.toLowerCase()}@${c.domain}`;
      this.logger.success('eazyreach', `Resolved and verified email: ${email}`);
      return {
        ...c,
        email,
        emailVerified: true,
      };
    });

    const successCount = resolved.filter((c) => c.email).length;
    this.logger.success('eazyreach', `Completed email resolution: ${successCount}/${contacts.length} emails resolved.`);
    return resolved;
  }
}
