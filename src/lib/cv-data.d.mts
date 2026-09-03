/**
 * Types for cv-data.mjs. The module itself stays plain JavaScript so a node
 * script and Vite can both load it unchanged; the types live here so the
 * Astro page gets checked against the same shape.
 */

/** Every leaf is a string, which is what lets the proof page treat any field
 *  as text without knowing which section produced it. */
export interface CvItem {
  title?: string;
  /** The right-hand column: a date, a period, a publication state. */
  right?: string;
  subtitle?: string;
  detail?: string;
}

export type CvStyle = 'entry' | 'work' | 'paper' | 'project' | 'skill' | 'note';

export interface CvSection {
  id: string;
  heading: string;
  style: CvStyle;
  items: CvItem[];
}

export interface Cv {
  author: string;
  contact: string[];
  summary: string;
  sections: CvSection[];
  siteHost: string;
}

/** A content entry, narrowed to what the shaper actually reads. */
export interface CvSource {
  id: string;
  data: Record<string, any>;
}

export interface CvInput {
  site?: readonly CvSource[];
  works?: readonly CvSource[];
  papers?: readonly CvSource[];
  education?: readonly CvSource[];
  projects?: readonly CvSource[];
  skills?: readonly CvSource[];
  referees?: readonly CvSource[];
  author?: string;
  siteUrl?: string;
  /** consts.ts values, used when the contact entry is silent. */
  fallback?: { email?: string; github?: string; linkedin?: string; location?: string };
}

export function buildCv(input?: CvInput): Cv;
