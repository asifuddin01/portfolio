export type TraceLanguage = 'python' | 'c' | 'java';

export const LANGUAGE_NAMES: Record<TraceLanguage, string> = { python: 'Python', c: 'C', java: 'Java' };

export function isTraceLanguage(value: unknown): value is TraceLanguage {
  return value === 'python' || value === 'c' || value === 'java';
}

export interface TraceExample {
  language: TraceLanguage;
  title: string;
  note: string;
  group: string;
  code: string;
  stdin: string;
}
