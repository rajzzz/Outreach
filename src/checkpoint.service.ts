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
      chalk.gray('Email'.padEnd(32)),
      chalk.gray('LinkedIn'),
    ].join('  ');

    console.log(header);
    console.log(chalk.gray('  ' + '─'.repeat(140)));

    contacts.forEach((c, i) => {
      const num    = chalk.gray(String(i + 1).padStart(3));
      const name   = chalk.white(c.fullName.padEnd(24).slice(0, 24));
      const title  = chalk.gray(c.title.padEnd(28).slice(0, 28));
      const co     = chalk.gray(c.company.padEnd(22).slice(0, 22));
      const email  = (c.email && c.emailVerified)
        ? chalk.green(c.email.padEnd(32).slice(0, 32))
        : c.email
        ? chalk.red(`${c.email} (unverified)`.padEnd(32).slice(0, 32))
        : chalk.red('missing'.padEnd(32));
      const linkedin = c.linkedinUrl
        ? chalk.cyan(c.linkedinUrl)
        : chalk.gray('—');
      console.log(`  ${num}  ${name}  ${title}  ${co}  ${email}  ${linkedin}`);
    });

    const verifiedCount = contacts.filter((c) => c.email && c.emailVerified).length;
    console.log('');
    console.log(
      chalk.gray(`  ${verifiedCount} of ${contacts.length} contacts have verified emails.`),
    );
    console.log('');
    this.logger.divider();
    console.log('');

    return this.prompt(
      chalk.yellow.bold(`  Send outreach to ${verifiedCount} contact(s)? [y/N] `),
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
        const lower = answer.trim().toLowerCase();
        resolve(lower === 'y' || lower === 'yes');
      });
    });
  }
}
