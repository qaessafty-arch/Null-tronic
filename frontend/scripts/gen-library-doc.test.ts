import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { LIBRARY_LIST } from '../src/component-library/library';

// Run with: npm run gen:docs
it('generates docs/engineering/component-library.md', () => {
  const rows = LIBRARY_LIST.map((d) => `| ${d.name} | \`${d.type}\` | ${d.category} | ${d.modes.join(', ')} | ${d.pins.map((p) => p.id).join(' ')} | ${d.simulation} | ${d.properties.map((p) => p.key + (p.unit ? ` (${p.unit})` : '') + (p.assumption ? '*' : '')).join(', ') || '—'} |`);
  const md = `# Component library\n\nGenerated from \`frontend/src/component-library/library.ts\` (${LIBRARY_LIST.length} definitions). Do not edit by hand: run \`npm run gen:docs\` in \`frontend/\`.\n\nEach definition provides pins (local mm coordinates shared by the 2D symbol and the 3D model), typed properties, an IEC 60617-style symbol, a parametric 3D model key and its simulation support (\`full\`, \`interactive\` = user-operated state, \`none\` = documented but not simulated).\n\nProperties marked * carry typical/assumed defaults that must be confirmed from datasheets or design rules; the UI flags them as **assumed**.\n\n| Name | Type | Category | Modes | Pins | Simulation | Properties |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n## Adding a component\n\n1. Add a \`ComponentDef\` to \`library.ts\` (pins on the 2.5 mm grid for schematics).\n2. Map it to elements in \`simulation/circuit.ts\` (or leave \`simulation: 'none'\` — it is then reported as *not evaluated*).\n3. Add a 3D builder case in \`viewport-3d/models.ts\` whose lead tips land on the pin coordinates (verified by \`tests/integration/input-system.test.ts\`).\n4. Regenerate this file.\n`;
  writeFileSync(new URL('../../docs/engineering/component-library.md', import.meta.url), md);
});
