/**
 * Probes the mock API and prints what it actually returns, so the seed can be
 * matched to the real payload instead of guessed at.
 *
 *   MOCK_API_URL=https://... npm run inspect:mock
 */
const base = (process.env['MOCK_API_URL'] ?? process.argv[2] ?? '').replace(/\/+$/, '');

if (!base) {
  console.error('Usage: MOCK_API_URL=https://host/path npm run inspect:mock');
  process.exit(1);
}

const CANDIDATE_PATHS = [
  '',
  '/products',
  '/modifier-groups',
  '/modifiers',
  '/modifier_groups',
  '/modifierGroups',
  '/menu',
  '/items',
  '/catalog',
];

function describe(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array (empty)';
    return `array[${value.length}] of:\n${pad}  ${describe(value[0], depth + 1)}`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => {
        const type = Array.isArray(v) ? `array[${v.length}]` : v === null ? 'null' : typeof v;
        const sample = type === 'string' || type === 'number' || type === 'boolean' ? ` = ${JSON.stringify(v)}` : '';
        return `\n${pad}  ${k}: ${type}${sample}`;
      })
      .join('');
  }
  return typeof value;
}

for (const path of CANDIDATE_PATHS) {
  const url = `${base}${path}`;
  process.stdout.write(`\n=== GET ${url}\n`);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timer);
    process.stdout.write(`    status: ${response.status} ${response.statusText}\n`);
    if (!response.ok) continue;

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      process.stdout.write(`    non-JSON body (first 200 chars): ${text.slice(0, 200)}\n`);
      continue;
    }
    process.stdout.write(`    shape: ${describe(parsed)}\n`);
    process.stdout.write(`    first 600 chars: ${JSON.stringify(parsed).slice(0, 600)}\n`);
  } catch (err) {
    process.stdout.write(`    ERROR: ${(err as Error).message}\n`);
  }
}
