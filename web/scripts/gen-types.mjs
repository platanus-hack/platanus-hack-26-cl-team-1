// Generate TypeScript types from the contracts' JSON Schemas (../contracts/schemas → src/contracts).
//   pnpm gen:types          write
//   pnpm check:types        fail if src/contracts is stale (CI)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, '..', '..', 'contracts', 'schemas');
const outDir = join(here, '..', 'src', 'contracts');
const check = process.argv.includes('--check');

const toPascal = (s) => s.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());
let stale = [];
for (const file of readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json')).sort()) {
  const name = file.replace('.schema.json', '');
  const schema = JSON.parse(readFileSync(join(schemasDir, file), 'utf8'));
  const ts = await compile(schema, toPascal(name), {
    bannerComment: `// Generated from contracts/schemas/${file} by scripts/gen-types.mjs. Do not edit.`,
    additionalProperties: false,
    unreachableDefinitions: false,
    format: true,
  });
  const out = join(outDir, `${name}.ts`);
  if (check) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== ts) stale.push(name);
  } else {
    writeFileSync(out, ts);
  }
}
if (check && stale.length) {
  console.error(`stale generated types: ${stale.join(', ')}; run \`pnpm gen:types\``);
  process.exit(1);
}
console.log(check ? 'generated types up to date' : `wrote types to ${outDir}`);
