import { Inject, Injectable } from '@nestjs/common';
import { Company, Contact } from '../../domain/models/outreach.models';
import { ContactFinder } from '../../domain/ports/contact-finder.port';
import { LoggerPort, LOGGER_PORT } from '../../../shared/logger/logger.port';

@Injectable()
export class ProspeoAdapter implements ContactFinder {
  constructor(
    @Inject(LOGGER_PORT)
    private readonly logger: LoggerPort,
  ) {}

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
}
