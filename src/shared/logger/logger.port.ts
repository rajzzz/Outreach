export type LogStage = 'ocean' | 'prospeo' | 'eazyreach' | 'brevo' | 'pipeline' | 'checkpoint';

export interface LoggerPort {
  info(stage: LogStage, message: string): void;
  success(stage: LogStage, message: string): void;
  warn(stage: LogStage, message: string): void;
  error(stage: LogStage, message: string): void;
  divider(): void;
  banner(seedDomain: string): void;
}

export const LOGGER_PORT = Symbol('LoggerPort');
