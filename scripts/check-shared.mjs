/**
 * The money helpers are duplicated between the backend and the mobile app on
 * purpose: a symlinked workspace package is the single most common reason an
 * Expo project fails to bundle on someone else's machine, and this app has to
 * run from a `git clone` and `npx expo start` with nothing else.
 *
 * Duplication is only safe if it is enforced, so this script fails when the two
 * copies drift. Run it with `npm run check:shared` from the repo root.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BACKEND = resolve(root, 'backend/src/utils/money.ts');
const MOBILE = resolve(root, 'apps/mobile/src/lib/money.ts');

/** Compare only the shared arithmetic, ignoring comments and platform-only extras. */
function extractFunctions(source) {
  const wanted = [
    'TAX_RATE',
    'computeTaxCents',
    'computeUnitPriceCents',
    'computeLineTotalCents',
    'computeSubtotalCents',
    'formatCents',
    'formatDelta',
  ];
  const stripped = source
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ');

  return wanted.map((name) => {
    const match = stripped.match(
      new RegExp(`export (?:const ${name} =[^;]+;|function ${name}\\s*\\([^)]*\\)[^{]*\\{[^}]*\\})`),
    );
    if (!match) throw new Error(`Could not find "${name}" — update check-shared.mjs`);
    return match[0].trim();
  });
}

const backend = extractFunctions(readFileSync(BACKEND, 'utf8'));
const mobile = extractFunctions(readFileSync(MOBILE, 'utf8'));

const drifted = backend
  .map((fn, i) => (fn === mobile[i] ? null : { backend: fn, mobile: mobile[i] }))
  .filter(Boolean);

if (drifted.length > 0) {
  console.error('Money helpers have drifted between backend and mobile:\n');
  for (const d of drifted) {
    console.error('  backend:', d.backend);
    console.error('  mobile: ', d.mobile, '\n');
  }
  console.error('The client computes totals the server re-verifies; these must match exactly.');
  process.exit(1);
}

console.log(`check:shared OK — ${backend.length} money helpers identical across backend and mobile`);
