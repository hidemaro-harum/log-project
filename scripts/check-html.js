const { readFileSync } = require('node:fs');

const html = readFileSync('index.html', 'utf8');
const requiredSnippets = [
  'id="wordText"',
  'assets/mogurepo-hero.svg',
  'const WORDS = [',
  'function renderWord',
];

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) {
    throw new Error(`Missing required snippet: ${snippet}`);
  }
}

console.log('index.html structure looks good');
