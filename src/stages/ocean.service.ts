import { Injectable } from '@nestjs/common';
import { Company } from '../models';
import { PipelineLogger } from '../utils/pipeline.logger';

@Injectable()
export class OceanService {
  constructor(private readonly logger: PipelineLogger) {}

  async findLookalikes(seedDomain: string): Promise<Company[]> {
    this.logger.info('ocean', `Searching for lookalike companies of ${seedDomain}...`);

    // Simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const name = seedDomain.split('.')[0];
    const capitalized = name.charAt(0).toUpperCase() + name.slice(1);

    const lookalikes: Company[] = [
      {
        domain: `${name}-global.com`,
        name: `${capitalized} Global`,
        industry: 'Technology & Software',
        employeeCount: '500-1000',
        location: 'San Francisco, CA',
      },
      {
        domain: `get${name}.com`,
        name: `Get ${capitalized}`,
        industry: 'Financial Services',
        employeeCount: '100-250',
        location: 'New York, NY',
      },
      {
        domain: `${name}hq.com`,
        name: `${capitalized} HQ`,
        industry: 'Enterprise Infrastructure',
        employeeCount: '1000-5000',
        location: 'London, UK',
      },
    ];

    this.logger.success('ocean', `Found ${lookalikes.length} lookalike companies.`);
    return lookalikes;
  }
}
