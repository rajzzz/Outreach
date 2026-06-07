import { Contact } from '../models/outreach.models';

export interface Checkpoint {
  confirm(contacts: Contact[]): Promise<boolean>;
}
