/** Types for cv-docx.mjs. See cv-data.d.mts for why the module is plain JS. */
import type { Cv } from './cv-data.mjs';

/** The CV as .docx bytes. Same input as `renderCv`. */
export function renderCvDocx(cv: Cv): Uint8Array;
