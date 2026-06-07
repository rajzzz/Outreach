import { Company } from '../models/outreach.models';

export interface CompanyDirectory {
  findLookalikes(seedDomain: string): Promise<Company[]>;
}
