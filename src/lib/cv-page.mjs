/**
 * Loads the CV for a page. Both /vitae/cv and /vitae/cv/edit call this, so
 * neither can shape the document differently from the other or from the
 * build script.
 */
import { getCollection } from 'astro:content';
import { buildCv } from './cv-data.mjs';
import { AUTHOR, SITE, EMAIL, GITHUB, LINKEDIN, LOCATION } from '../consts.ts';

export const CV_PDF = '/cv/Md-Asif-Uddin-CV.pdf';

export async function loadCv() {
  const [site, works, papers, education, projects, skills] = await Promise.all([
    getCollection('site'),
    getCollection('works'),
    getCollection('papers'),
    getCollection('education'),
    getCollection('projects'),
    getCollection('instrumentarium'),
  ]);
  return buildCv({
    site, works, papers, education, projects, skills,
    author: AUTHOR,
    siteUrl: SITE,
    fallback: { email: EMAIL, github: GITHUB, linkedin: LINKEDIN, location: LOCATION },
  });
}
