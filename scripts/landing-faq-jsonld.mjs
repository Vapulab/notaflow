// Rewrites the FAQPage of the landing's JSON-LD from the questions on the page: run it after any FAQ edit.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const path = fileURLToPath(new URL('../apps/web/landing.html', import.meta.url));
const html = readFileSync(path, 'utf8');
const clean = (text) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const questions = [
  ...html.matchAll(
    /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<span[\s\S]*?<\/summary>\s*<p[^>]*>([\s\S]*?)<\/p>/g,
  ),
].map((m) => ({
  '@type': 'Question',
  name: clean(m[1]),
  acceptedAnswer: { '@type': 'Answer', text: clean(m[2]) },
}));

const block = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/;
const found = html.match(block);
if (!found) throw new Error('landing.html has no JSON-LD block');
const data = JSON.parse(found[2]);
const faq = data['@graph'].find((node) => node['@type'] === 'FAQPage');
if (!faq) throw new Error('the JSON-LD has no FAQPage');
faq.mainEntity = questions;

const json = JSON.stringify(data, null, 2).replace(/\n/g, '\n    ');
writeFileSync(path, html.replace(block, `$1\n    ${json}\n    $3`));
console.log(`FAQPage: ${questions.length} questions`);
