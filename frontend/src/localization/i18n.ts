/**
 * Minimal localisation layer. English is complete; other locales fall back to English per key.
 * The structure is ready for Arabic / Kurdish (Sorani) — right-to-left layout is enabled through
 * the `dir` attribute when such a locale is selected. Translations must be supplied by
 * qualified translators; none are machine-generated here.
 */

export type Locale = 'en';

const en = {
  'menu.file': 'File',
  'menu.edit': 'Edit',
  'menu.view': 'View',
  'menu.project': 'Project',
  'menu.components': 'Components',
  'menu.engineering': 'Engineering',
  'menu.simulation': 'Simulation',
  'menu.tools': 'Tools',
  'menu.export': 'Export',
  'menu.help': 'Help',
  'panel.library': 'Component library',
  'panel.properties': 'Properties',
  'status.ready': 'Ready',
} as const;

export type MessageKey = keyof typeof en;
const tables: Record<Locale, Partial<Record<MessageKey, string>>> = { en };
let current: Locale = 'en';

export function setLocale(l: Locale): void {
  current = l;
}

export function t(key: MessageKey): string {
  return tables[current][key] ?? en[key];
}

export const RTL_LOCALES = new Set<string>(['ar', 'ckb']);
