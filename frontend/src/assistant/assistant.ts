import { ProjectBuilder } from '../project-model/builder';
import { getDef, LIBRARY_LIST } from '../component-library/library';
import { makeComponent } from '../project-model/factory';
import { addComponent, connectPins, setProperty } from '../project-model/operations';
import { pointInPolygon } from '../project-model/geometry';
import { planCircuit } from '../project-model/installation';
import { addCircuit } from '../project-model/operations';
import { parseSI, formatSI } from '../calculations/units';
import { calculateInstallation } from '../calculations/installation';
import { buildBom } from '../calculations/bom';
import { runOperatingPoint } from '../simulation/simulate';
import { validateProject } from '../calculations/validation';
import type { Project, Vec2 } from '../project-model/types';

/**
 * Local, offline engineering assistant. It understands a fixed set of request patterns and turns
 * them into PROPOSED model operations. Proposals are staged as previews and go through the same
 * validation and confirmation as any other operation — the assistant never edits the model
 * directly and never invents component values: anything not stated is left at the library
 * default and reported. An LLM back-end can be plugged in behind `AssistantProvider` later.
 */

export interface AssistantReply {
  text: string;
  /** Operation to preview & confirm, if any. */
  proposal?: { label: string; apply: (p: Project) => Project };
  needs?: string[];
}

export interface AssistantProvider {
  name: string;
  respond(input: string, project: Project): AssistantReply | Promise<AssistantReply>;
}

const findValue = (s: string, unitRe: string): number | null => {
  const m = new RegExp(`(\\d+(?:\\.\\d+)?\\s*(?:meg|[kKmMuµnp])?)\\s*(?:${unitRe})`, 'i').exec(s);
  if (!m) return null;
  const v = parseSI(m[1].replace(/\s+/g, ''));
  return Number.isFinite(v) ? v : null;
};

function freeOrigin(p: Project): Vec2 {
  const xs = Object.values(p.components).map((c) => c.position.x);
  return { x: xs.length ? Math.ceil((Math.max(...xs) + 30) / 5) * 5 : 0, y: 0 };
}

export const localAssistant: AssistantProvider = {
  name: 'Local rule-based assistant (offline)',
  respond(input: string, project: Project): AssistantReply {
    const s = input.trim().toLowerCase();
    if (!s) return { text: 'Ask me to build, place, connect, explain or summarise something.' };

    // ---------- LED circuit
    if (/\bled\b/.test(s) && /(create|build|make|add)/.test(s)) {
      if (project.type === 'installation') return { text: 'LED circuits belong in an electronic project. Create one with File ▸ New project.' };
      const vs = findValue(s, 'v\\b|volt') ;
      const r = findValue(s, 'ohm|Ω|r\\b');
      const needs: string[] = [];
      const supply = vs ?? 9;
      if (vs === null) needs.push('supply voltage (assumed 9 V — library default)');
      const color = ['red', 'green', 'blue', 'yellow', 'white'].find((c) => s.includes(c)) ?? 'red';
      // series resistor from Ohm's law using the LED's typical Vf and a 10 mA target when not given
      const ledDef = getDef('led');
      const vf = { red: 1.9, yellow: 2.0, green: 2.1, blue: 3.1, white: 3.1 }[color]!;
      const target = 0.01;
      const res = r ?? Math.max(10, (supply - vf) / target);
      if (r === null) needs.push(`resistor computed as (Vs − Vf)/I = (${supply} − ${vf}) / 10 mA = ${formatSI(res, 'Ω')} (choose the nearest preferred value)`);
      if (supply <= vf) return { text: `A ${supply} V supply cannot forward-bias a ${color} LED (Vf ≈ ${vf} V, typical).` };
      const o = freeOrigin(project);
      return {
        text: `Proposed: ${supply} V source → ${formatSI(res, 'Ω')} resistor → ${color} ${ledDef.name} → ground. Preview it, then confirm.`,
        needs,
        proposal: {
          label: 'Assistant: LED circuit',
          apply: (p) => {
            const b = new ProjectBuilder(p);
            const v1 = b.add('vdc', { x: o.x, y: o.y + 10 }, { voltage: supply });
            const r1 = b.add('resistor', { x: o.x + 15, y: o.y + 5 }, { resistance: res });
            const d1 = b.add('led', { x: o.x + 30, y: o.y + 5 }, { color, vf });
            const g1 = b.add('ground', { x: o.x, y: o.y + 20 });
            const g2 = b.add('ground', { x: o.x + 35, y: o.y + 20 });
            b.wire(v1, '+', r1, '1').wire(r1, '2', d1, 'A').wire(d1, 'K', g2, '1').wire(v1, '-', g1, '1');
            return b.build();
          },
        },
      };
    }

    // ---------- place N items in a room
    const placeM = /place\s+(\d+|one|two|three|four|five|six)\s+(lights?|luminaires?|sockets?|outlets?)\s+in\s+(?:the\s+)?(.+)/.exec(s);
    if (placeM) {
      if (project.type !== 'installation') return { text: 'Room placement needs an installation project.' };
      const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
      const n = words[placeM[1]] ?? parseInt(placeM[1], 10);
      const type = placeM[2].startsWith('light') || placeM[2].startsWith('lum') ? 'light' : 'socket';
      const roomName = placeM[3].replace(/[.!?]$/, '').trim();
      const room = Object.values(project.rooms).find((r) => r.name.toLowerCase() === roomName) ?? Object.values(project.rooms).find((r) => r.name.toLowerCase().includes(roomName));
      if (!room) return { text: `I could not find a room called “${roomName}”. Rooms: ${Object.values(project.rooms).map((r) => r.name).join(', ') || 'none'}.` };
      const xs = room.polygon.map((q) => q.x);
      const ys = room.polygon.map((q) => q.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const cols = Math.ceil(Math.sqrt(n * ((x1 - x0) / (y1 - y0))));
      const rows = Math.ceil(n / cols);
      const pts: Vec2[] = [];
      if (type === 'light') {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols && pts.length < n; c++) pts.push({ x: Math.round(x0 + ((c + 0.5) * (x1 - x0)) / cols), y: Math.round(y0 + ((r + 0.5) * (y1 - y0)) / rows) });
      } else {
        // sockets along the walls, 300 mm inside
        const per = (2 * (x1 - x0 + y1 - y0)) / n;
        for (let i = 0; i < n; i++) {
          let d = (i + 0.5) * per;
          const w = x1 - x0;
          const h = y1 - y0;
          if (d < w) pts.push({ x: x0 + d, y: y0 + 300 });
          else if ((d -= w) < h) pts.push({ x: x1 - 300, y: y0 + d });
          else if ((d -= h) < w) pts.push({ x: x1 - d, y: y1 - 300 });
          else pts.push({ x: x0 + 300, y: y1 - (d - w) });
        }
      }
      const inside = pts.filter((q) => pointInPolygon(q, room.polygon));
      return {
        text: `Proposed: ${inside.length} ${type === 'light' ? 'luminaire(s) on an even grid' : 'socket outlet(s) spaced along the walls'} in ${room.name}. Loads use library defaults (${type === 'socket' ? '200 W allowance, marked as assumption' : '18 W'}).`,
        proposal: {
          label: `Assistant: place ${inside.length} ${type}(s) in ${room.name}`,
          apply: (p) => inside.reduce((q, at) => addComponent(q, makeComponent(q, type, at)), p),
        },
      };
    }

    // ---------- connect devices to a circuit
    const circM = /connect\s+(.+?)\s+to\s+(db\d+|board)/.exec(s);
    if (circM && project.type === 'installation') {
      const board = Object.values(project.components).find((c) => getDef(c.type).isBoard && (circM[2] === 'board' || c.ref.toLowerCase() === circM[2]));
      if (!board) return { text: 'No matching distribution board.' };
      const used = new Set(Object.values(project.circuits).flatMap((c) => c.deviceIds));
      const refs = circM[1].split(/[\s,]+(?:and\s+)?/).map((x) => x.trim()).filter(Boolean);
      let devices = Object.values(project.components).filter((c) => refs.includes(c.ref.toLowerCase()));
      if (refs.some((r) => /unconnected|all/.test(r))) devices = Object.values(project.components).filter((c) => (getDef(c.type).isLoad || c.type === 'switch_1way') && !used.has(c.id));
      if (!devices.length) return { text: 'I could not identify the devices. Use reference designators (e.g. “connect L1, L2 to DB1”) or “connect unconnected devices to DB1”.' };
      const ids = devices.map((d) => d.id);
      return {
        text: `Proposed circuit from ${board.ref} feeding ${devices.map((d) => d.ref).join(', ')} with auto-routed cables. Protection and cable size are left for the engine to suggest.`,
        proposal: { label: `Assistant: circuit from ${board.ref}`, apply: (p) => { const plan = planCircuit(p, board.id, ids); return addCircuit(p, plan.circuit, plan.cables); } },
      };
    }

    // ---------- connect two pins: "connect R1.2 to D1.A"
    const pinM = /connect\s+([a-z]+\d+)\.(\S+)\s+to\s+([a-z]+\d+)\.(\S+)/.exec(s);
    if (pinM) {
      const find = (ref: string) => Object.values(project.components).find((c) => c.ref.toLowerCase() === ref);
      const a = find(pinM[1]);
      const b = find(pinM[3]);
      if (!a || !b) return { text: 'Unknown reference designator.' };
      const pa = getDef(a.type).pins.find((x) => x.id.toLowerCase() === pinM[2] || x.name.toLowerCase() === pinM[2]);
      const pb = getDef(b.type).pins.find((x) => x.id.toLowerCase() === pinM[4] || x.name.toLowerCase() === pinM[4]);
      if (!pa || !pb) return { text: `Pins available: ${a.ref}: ${getDef(a.type).pins.map((x) => x.id).join(', ')}; ${b.ref}: ${getDef(b.type).pins.map((x) => x.id).join(', ')}.` };
      return { text: `Proposed wire ${a.ref}.${pa.id} → ${b.ref}.${pb.id}.`, proposal: { label: 'Assistant: wire', apply: (p) => connectPins(p, { componentId: a.id, pinId: pa.id }, { componentId: b.id, pinId: pb.id }) } };
    }

    // ---------- set a value: "set R1 to 2.2k"
    const setM = /set\s+([a-z]+\d+)\s+(?:to\s+)?([\d.]+\s*(?:meg|[kmunpµ])?)/i.exec(input);
    if (setM) {
      const c = Object.values(project.components).find((x) => x.ref.toLowerCase() === setM[1].toLowerCase());
      if (!c) return { text: 'Unknown component.' };
      const key = getDef(c.type).properties.find((pd) => pd.kind === 'number')?.key;
      if (!key) return { text: `${c.ref} has no numeric value.` };
      const v = parseSI(setM[2].replace(/\s/g, ''));
      return { text: `Proposed: ${c.ref}.${key} = ${v}.`, proposal: { label: `Assistant: set ${c.ref}`, apply: (p) => setProperty(p, c.id, key, v) } };
    }

    // ---------- voltage across a component
    const vM = /(?:voltage|current|power).*?\b([a-z]+\d+)\b/.exec(s);
    if (vM && project.type !== 'installation') {
      const c = Object.values(project.components).find((x) => x.ref.toLowerCase() === vM[1]);
      if (!c) return { text: 'Unknown component.' };
      const r = runOperatingPoint(project);
      if (!r.ok) return { text: `I could not simulate the circuit: ${r.error}` };
      const cr = r.components[c.id];
      if (!cr) return { text: `${c.ref} is not part of the simulated circuit.` };
      return { text: `${c.ref} (operating point): V = ${formatSI(cr.voltage ?? 0, 'V', 4)}, I = ${formatSI(cr.current ?? 0, 'A', 4)}, P = ${formatSI(cr.power ?? 0, 'W', 4)}. Source: built-in MNA solver.` };
    }

    // ---------- why is it not working
    if (/(why|not working|problem|wrong|check)/.test(s)) {
      const f = validateProject(project).filter((x) => x.status === 'error' || x.status === 'warning');
      const extra: string[] = [];
      if (project.type !== 'installation') {
        const r = runOperatingPoint(project);
        if (!r.ok) extra.push(`Simulation fails: ${r.error}`);
        else extra.push(...r.findings.filter((x) => x.status === 'error' || x.status === 'warning').map((x) => x.message));
      }
      const all = [...f.map((x) => x.message), ...extra];
      return { text: all.length ? `I found these issues:\n• ${[...new Set(all)].slice(0, 10).join('\n• ')}` : 'No errors or warnings within the supported checks. That does not prove the design is correct or safe — review it against your requirements.' };
    }

    // ---------- BOM / summary
    if (/(bom|bill of materials)/.test(s)) {
      const b = buildBom(project);
      return { text: b.lines.map((l) => `${l.quantity} ${l.unit} × ${l.description}`).join('\n') || 'Empty project.' };
    }
    if (/(load|schedule|summary)/.test(s) && project.type === 'installation') {
      const rep = calculateInstallation(project);
      return { text: rep.circuits.map((c) => `${c.name}: ${c.connectedW.toFixed(0)} W, Ib ${c.ibA.toFixed(2)} A, ΔU ${c.dropPct.toFixed(2)} %, ${c.status}`).join('\n') || 'No circuits yet.' };
    }
    if (/single[- ]line/.test(s)) return { text: 'Open Print / drawing sheets and add a “single-line” sheet: it is generated from the boards and circuits in this project.' };

    // ---------- explain a component
    const exM = /(?:explain|what is|difference)\s+(.+)/.exec(s);
    if (exM) {
      const hits = LIBRARY_LIST.filter((d) => exM[1].includes(d.name.toLowerCase()) || exM[1].includes(d.type.replace('_', ' ')));
      if (hits.length) return { text: hits.map((d) => `${d.name}: ${d.description}`).join('\n\n') };
    }
    return {
      text: 'I can: “create a red LED circuit with 12 V”, “place 4 lights in living room”, “connect L1, L2 to DB1”, “connect R1.2 to D1.A”, “set R1 to 2.2k”, “show the voltage across R1”, “why is this not working”, “bill of materials”, “load summary”, “explain zener diode”.',
    };
  },
};
