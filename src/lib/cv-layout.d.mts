/** Types for cv-layout.mjs. See cv-data.d.ts for why the module is plain JS. */
import type { Cv } from './cv-data.mjs';

export function renderCv(cv: Cv): Promise<{ bytes: Uint8Array; pages: number }>;
