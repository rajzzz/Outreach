import { Contact } from '../models/outreach.models';

export interface EmailResolver {
  resolveEmails(contacts: Contact[]): Promise<Contact[]>;
}
