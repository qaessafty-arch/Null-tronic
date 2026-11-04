import { it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { EXAMPLES } from '../src/education/examples';
import { serializeProject } from '../src/project-model/serialization';

// Writes every example as a native project file into examples/ (sample projects shipped with the repo).
it('exports example projects', () => {
  const dir = new URL('../../examples/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const e of EXAMPLES) writeFileSync(new URL(`${e.id}.ntcs.json`, dir), serializeProject(e.build()));
});
