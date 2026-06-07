import { Contact } from '../models/outreach.models';

export interface OutreachSender {
  sendOutreach(contacts: Contact[], seedDomain: string): Promise<number>;
}
