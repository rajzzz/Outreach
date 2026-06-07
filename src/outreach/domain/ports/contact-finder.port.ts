import { Company, Contact } from '../models/outreach.models';

export interface ContactFinder {
  findDecisionMakers(companies: Company[]): Promise<Contact[]>;
}
