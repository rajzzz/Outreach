import { Injectable } from '@nestjs/common';
import chalk from 'chalk';
import { LoggerPort, LogStage } from './logger.port';

const STAGE_COLORS: Record<LogStage, chalk.Chalk> = {
  ocean:      chalk.magenta,
  prospeo:    chalk.cyan,
  eazyreach:  chalk.red,
  brevo:      chalk.blue,
  pipeline:   chalk.white,
  checkpoint: chalk.yellow,
};

const STAGE_LABELS: Record<LogStage, string> = {
  ocean:      '[ Ocean.io  ]',
  prospeo:    '[ Prospeo   ]',
  eazyreach:  '[ Eazyreach ]',
  brevo:      '[ Brevo     ]',
  pipeline:   '[ Pipeline  ]',
  checkpoint: '[ Confirm   ]',
};

@Injectable()
export class PipelineLoggerAdapter implements LoggerPort {
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
