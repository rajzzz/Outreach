import { Injectable } from '@nestjs/common';
import chalk from 'chalk';

export type LogStage = 'ocean' | 'prospeo' | 'brevo' | 'pipeline' | 'checkpoint';

const STAGE_COLORS: Record<LogStage, chalk.Chalk> = {
  ocean:      chalk.magenta,
  prospeo:    chalk.cyan,
  brevo:      chalk.blue,
  pipeline:   chalk.white,
  checkpoint: chalk.yellow,
};

const STAGE_LABELS: Record<LogStage, string> = {
  ocean:      '[ Ocean.io  ]',
  prospeo:    '[ Prospeo   ]',
  brevo:      '[ Brevo     ]',
  pipeline:   '[ Pipeline  ]',
  checkpoint: '[ Confirm   ]',
};

@Injectable()
export class PipelineLogger {
  info(stage: LogStage, message: string): void {
    const color = STAGE_COLORS[stage];
    console.log(`${color(STAGE_LABELS[stage])} ${message}`);
  }

  success(stage: LogStage, message: string): void {
    const color = STAGE_COLORS[stage];
    console.log(`${color(STAGE_LABELS[stage])} ${chalk.green('✓')} ${message}`);
  }

  warn(stage: LogStage, message: string): void {
    const color = STAGE_COLORS[stage];
    console.log(`${color(STAGE_LABELS[stage])} ${chalk.yellow('⚠')} ${message}`);
  }

  error(stage: LogStage, message: string): void {
    const color = STAGE_COLORS[stage];
    console.log(`${color(STAGE_LABELS[stage])} ${chalk.red('✗')} ${message}`);
  }

  divider(): void {
    console.log(chalk.gray('─'.repeat(60)));
  }

  banner(seedDomain: string): void {
    console.log('');
    console.log(chalk.bold.white('  VocalLabs Outreach Pipeline'));
    console.log(chalk.gray(`  Seed domain: ${chalk.white(seedDomain)}`));
    console.log('');
  }
}
