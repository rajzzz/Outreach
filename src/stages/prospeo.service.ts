import { Injectable } from '@nestjs/common';
import { Company, Contact } from '../models';
import { PipelineLogger } from '../utils/pipeline.logger';

@Injectable()
export class ProspeoService {
  constructor(private readonly logger: PipelineLogger) {}

  async findDecisionMakers(companies: Company[]): Promise<Contact[]> {
    this.logger.info('prospeo', `Finding decision-makers for ${companies.length} companies...`);

    // Simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const titles = [
      { name: 'Sarah Connor', title: 'VP of Engineering' },
      { name: 'David Miller', title: 'Head of Growth' },
      { name: 'Alex Rivera', title: 'Chief Technology Officer' },
    ];

    const contacts: Contact[] = [];

    companies.forEach((co, idx) => {
      const person = titles[idx % titles.length];
      const firstName = person.name.split(' ')[0];
      const lastName = person.name.split(' ')[1];
      contacts.push({
        firstName,
        lastName,
        fullName: person.name,
        title: person.title,
        company: co.name || co.domain,
        domain: co.domain,
        linkedinUrl: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`,
      });
    });

    this.logger.success('prospeo', `Found ${contacts.length} decision-makers across companies.`);
    return contacts;
  }

  async resolveEmails(contacts: Contact[]): Promise<Contact[]> {
    this.logger.info('prospeo', `Resolving and verifying work email addresses for ${contacts.length} contacts...`);

    // Simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const resolved = contacts.map((c) => {
      if (c.firstName.toLowerCase() === 'david') {
        this.logger.warn('prospeo', `Could not find a valid email pattern for ${c.fullName} at ${c.domain}`);
        return c;
      }

      const email = `${c.firstName.toLowerCase()}.${c.lastName.toLowerCase()}@${c.domain}`;
      this.logger.success('prospeo', `Resolved and verified email: ${email}`);
      return {
        ...c,
        email,
        emailVerified: true,
      };
    });

    const successCount = resolved.filter((c) => c.email).length;
    this.logger.success('prospeo', `Completed email resolution: ${successCount}/${contacts.length} emails resolved.`);
    return resolved;
  }
}
