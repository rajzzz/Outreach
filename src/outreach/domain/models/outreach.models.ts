/**
 * outreach.models.ts
 * The three core types that flow through the pipeline.
 * Each stage accepts one type and returns the next.
 */

export interface Company {
  domain: string;
  name?: string;
  industry?: string;
  employeeCount?: string;
  location?: string;
}

export interface Contact {
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  company: string;
  domain: string;
  linkedinUrl: string;
  email?: string;          // populated by Eazyreach in Stage 3
  emailVerified?: boolean;
}

export interface EmailPayload {
  to: string;
  toName: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  contact: Contact;
}

export interface PipelineResult {
  seedDomain: string;
  companiesFound: number;
  contactsFound: number;
  emailsResolved: number;
  emailsSent: number;
  errors: PipelineError[];
  durationMs: number;
}

export interface PipelineError {
  stage: 'ocean' | 'prospeo' | 'eazyreach' | 'brevo';
  message: string;
  context?: string;
}
