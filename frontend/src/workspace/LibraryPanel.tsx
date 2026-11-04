import { useMemo, useState, useEffect, useRef } from 'react';
import { LIBRARY_LIST } from '../component-library/library';
import type { ComponentDef } from '../component-library/types';
import { useStore, store } from '../state/store';
import { Icon } from '../components/Icon';
import { primitiveBounds } from '../drawing/primitives';
import { primitivesToSvgElements } from '../export/svg';

const FAV_KEY = 'ntcs.favorites';
const RECENT_KEY = 'ntcs.recent';
const read = (k: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '[]');
  } catch {
    return [];
  }
};
const write = (k: string, v: string[]) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

function SymbolThumb({ def }: { def: ComponentDef }) {
  const svg = useMemo(() => {
    const prims = def.symbol(Object.fromEntries(def.properties.map((p) => [p.key, p.default])));
    const b = primitiveBounds(prims.filter((p) => p.k !== 'text'));
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.12 + 0.5;
    const vb = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
    const scale = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 12;
    const widened = prims.map((p) => ('w' in p ? { ...p, w: Math.max(p.w ?? 0.25, 0.35 * scale) } : p));
    return { vb, body: primitivesToSvgElements(widened, { defaultColor: 'currentColor', monochrome: true }) };
  }, [def]);
  return <svg className="thumb" viewBox={svg.vb} dangerouslySetInnerHTML={{ __html: svg.body }} aria-hidden="true" />;
}

export function LibraryPanel() {
  const type = useStore((s) => s.project.type);
  const placeType = useStore((s) => s.placeType);
  const tool = useStore((s) => s.tool);
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<string[]>(() => read(FAV_KEY));
  const [recent, setRecent] = useState<string[]>(() => read(RECENT_KEY));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => write(FAV_KEY, favs), [favs]);
  const defs = LIBRARY_LIST.filter((d) => d.modes.includes(type));
  const filtered = defs.filter((d) => !q || `${d.name} ${d.category} ${d.type} ${d.refPrefix}`.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, ComponentDef[]>();
  for (const d of filtered) groups.set(d.category, [...(groups.get(d.category) ?? []), d]);
  const pick = (d: ComponentDef) => {
    store.set({ tool: 'place', placeType: d.type, placeRotation: 0 });
    const r = [d.type, ...recent.filter((x) => x !== d.type)].slice(0, 6);
    setRecent(r);
    write(RECENT_KEY, r);
  };
  const item = (d: ComponentDef) => (
    <div key={d.type} className={`lib-item ${tool === 'place' && placeType === d.type ? 'active' : ''}`} role="button" tabIndex={0} title={d.description} onClick={() => pick(d)} onKeyDown={(e) => e.key === 'Enter' && pick(d)} data-type={d.type}>
      <SymbolThumb def={d} />
      <span className="lib-name">{d.name}</span>
      <button
        className={`fav ${favs.includes(d.type) ? 'on' : ''}`}
        aria-label={favs.includes(d.type) ? 'Remove favourite' : 'Add favourite'}
        onClick={(e) => {
          e.stopPropagation();
          setFavs(favs.includes(d.type) ? favs.filter((x) => x !== d.type) : [...favs, d.type]);
        }}
      >
        <Icon name="star" size={12} />
      </button>
    </div>
  );
  const byType = (t: string) => defs.find((d) => d.type === t);
  return (
    <aside className="panel panel-left" aria-label="Component library">
      <div className="panel-head">
        <h3>Component library</h3>
        <span className="muted">{defs.length}</span>
      </div>
      <div className="search">
        <Icon name="search" size={14} />
        <input ref={searchRef} placeholder="Search components…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search components" />
      </div>
      <div className="panel-scroll">
        {!q && favs.some(byType) && (
          <section>
            <h4>Favourites</h4>
            <div className="lib-grid">{favs.map(byType).filter(Boolean).map((d) => item(d!))}</div>
          </section>
        )}
        {!q && recent.some(byType) && (
          <section>
            <h4>Recent</h4>
            <div className="lib-grid">{recent.map(byType).filter(Boolean).map((d) => item(d!))}</div>
          </section>
        )}
        {[...groups.entries()].map(([cat, list]) => (
          <section key={cat}>
            <h4 className="collapsible" onClick={() => setCollapsed({ ...collapsed, [cat]: !collapsed[cat] })}>
              <Icon name="chevron" size={12} className={collapsed[cat] ? '' : 'rot90'} /> {cat} <span className="muted">{list.length}</span>
            </h4>
            {!collapsed[cat] && <div className="lib-grid">{list.map(item)}</div>}
          </section>
        ))}
        {filtered.length === 0 && <p className="empty">No components match “{q}”.</p>}
      </div>
    </aside>
  );
}
