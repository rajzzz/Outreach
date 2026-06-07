import { Injectable } from '@nestjs/common';
import * as readline from 'readline';
import chalk from 'chalk';
import { Contact } from './models';
import { PipelineLogger } from './utils/pipeline.logger';

@Injectable()
export class CheckpointService {
  constructor(private readonly logger: PipelineLogger) {}

  async confirm(contacts: Contact[]): Promise<boolean> {
    this.logger.divider();
    console.log('');
    console.log(chalk.yellow.bold('  Safety checkpoint — review before sending'));
    console.log('');

    // Print summary table
    const header = [
      chalk.gray('  #'),
      chalk.gray('Name'.padEnd(24)),
      chalk.gray('Title'.padEnd(28)),
      chalk.gray('Company'.padEnd(22)),
      chalk.gray('Email'),
    ].join('  ');

    console.log(header);
    console.log(chalk.gray('  ' + '─'.repeat(110)));

    contacts.forEach((c, i) => {
      const num    = chalk.gray(String(i + 1).padStart(3));
      const name   = chalk.white(c.fullName.padEnd(24).slice(0, 24));
      const title  = chalk.gray(c.title.padEnd(28).slice(0, 28));
      const co     = chalk.gray(c.company.padEnd(22).slice(0, 22));
      const email  = c.email
        ? chalk.green(c.email)
        : chalk.red('no email resolved');
      console.log(`  ${num}  ${name}  ${title}  ${co}  ${email}`);
    });

    const withEmail = contacts.filter((c) => c.email).length;
    console.log('');
    console.log(
      chalk.gray(`  ${withEmail} of ${contacts.length} contacts have verified emails.`),
    );
    console.log('');
    this.logger.divider();
    console.log('');

    return this.prompt(
      chalk.yellow.bold(`  Send outreach to ${withEmail} contact(s)? [y/N] `),
    );
  }

  private prompt(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  }
}
