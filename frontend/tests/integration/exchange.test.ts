import { describe, expect, it } from 'vitest';
import { EXAMPLES, sampleInstallation } from '../../src/education/examples';
import { composeSheet } from '../../src/printing/sheet';
import { buildPdf } from '../../src/export/pdf';
import { sheetToSvg } from '../../src/export/svg';
import { exportDxf, importDxf } from '../../src/export/dxf';
import { importSpice, spiceNumber } from '../../src/export/spice-import';
import { toSpice } from '../../src/simulation/spice';
import { runOperatingPoint, type OpResult } from '../../src/simulation/simulate';
import { parseProject, serializeProject, ProjectFormatError } from '../../src/project-model/serialization';
import { defaultSheet } from '../../src/project-model/factory';
import { scenePrimitives } from '../../src/drawing/scene';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('native project format', () => {
  it('round-trips every example without loss', () => {
    for (const ex of EXAMPLES) {
      const p = ex.build();
      const back = parseProject(serializeProject(p)).project;
      expect(back).toEqual(p);
    }
  });

  it('rejects malformed files with precise messages', () => {
    const p = EXAMPLES[0].build();
    const raw = JSON.parse(serializeProject(p));
    const wid = Object.keys(raw.wires)[0];
    raw.wires[wid].a = { kind: 'pin', componentId: 'missing', pinId: '1' };
    expect(() => parseProject(JSON.stringify(raw))).toThrow(ProjectFormatError);
    try {
      parseProject(JSON.stringify(raw));
    } catch (e) {
      expect((e as ProjectFormatError).issues.join(' ')).toContain('missing component');
    }
    expect(() => parseProject('{not json')).toThrow(/Not valid JSON/);
  });

  it('migrates schema version 0 files', () => {
    const p = EXAMPLES[0].build();
    const raw = JSON.parse(serializeProject(p));
    raw.schemaVersion = 0;
    raw.items = raw.components;
    delete raw.components;
    delete raw.layers;
    const { project, migratedFrom } = parseProject(JSON.stringify(raw));
    expect(migratedFrom).toBe(0);
    expect(Object.keys(project.components)).toHaveLength(Object.keys(p.components).length);
    expect(project.layers.length).toBeGreaterThan(0);
  });
});

describe('drawing sheets and vector exports', () => {
  it('composes an A3 installation plan at 1:100 with a title block', () => {
    const p = sampleInstallation();
    const s = composeSheet(p, p.sheets[0]);
    expect(s.width).toBe(420);
    expect(s.height).toBe(297);
    expect(s.scaleLabel).toBe('1:100');
    expect(s.prims.some((x) => x.k === 'text' && x.text === p.meta.name)).toBe(true);
    expect(s.warnings).toEqual([]);
  });

  it('produces a structurally valid multi-page vector PDF', () => {
    const p = sampleInstallation();
    const sheets = [p.sheets[0], { ...defaultSheet('installation'), kind: 'schedule' as const, paper: 'A4' as const, title: 'Schedule' }, { ...defaultSheet('installation'), kind: 'single-line' as const, title: 'SLD' }];
    const pages = sheets.map((s, i) => composeSheet(p, s, i + 1, sheets.length));
    const pdf = buildPdf(pages, { title: p.meta.name });
    const s = latin1(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect((s.match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
    expect(s).toContain('/MediaBox [0 0 1190.551 841.89]'); // A3 landscape in points
    // xref offsets point at "n 0 obj"
    const xref = parseInt(/startxref\n(\d+)/.exec(s)![1], 10);
    const entries = s.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l));
    entries.forEach((e, i) => {
      const off = parseInt(e.slice(0, 10), 10);
      expect(s.slice(off, off + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
    // vector content: path operators present, no images
    expect(s).toMatch(/ l\n/);
    expect(s).not.toContain('/Image');
  });

  it('writes SVG for a schematic sheet', () => {
    const p = EXAMPLES.find((e) => e.id === 'led')!.build();
    const svg = sheetToSvg(composeSheet(p, p.sheets[0]));
    expect(svg).toContain('<svg');
    expect(svg).toContain('R1');
    expect(svg).toContain('viewBox="0 0 420 297"');
  });
});

describe('DXF', () => {
  it('exports model space and re-imports the same geometry count', () => {
    const p = sampleInstallation();
    const dxf = exportDxf(p);
    expect(dxf).toContain('AC1009');
    const prims = scenePrimitives(p).flatMap((e) => e.prims);
    const res = importDxf(dxf);
    expect(res.annotations.length).toBe(prims.length);
    expect(res.layers).toEqual(expect.arrayContaining(['COMPONENTS', 'CABLES', 'ARCHITECTURE']));
    // a room polygon survives with its coordinates (y flipped twice)
    const room = Object.values(p.rooms)[0];
    const match = res.annotations.find((a) => a.kind === 'polyline' && a.closed && a.points.length === 4 && Math.abs(a.points[0].x - room.polygon[0].x) < 1e-6 && Math.abs(a.points[0].y - room.polygon[0].y) < 1e-6);
    expect(match).toBeTruthy();
  });

  it('imports LWPOLYLINE in metres and converts to millimetres', () => {
    const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', 'WALLS', '90', '4', '70', '1', '10', '0', '20', '0', '10', '5', '20', '0', '10', '5', '20', '4', '10', '0', '20', '4', '0', 'INSERT', '8', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const r = importDxf(dxf);
    expect(r.unitScale).toBe(1000);
    expect(r.closedPolylines[0][2]).toEqual({ x: 5000, y: -4000 });
    expect(r.skipped.INSERT).toBe(1);
  });
});

describe('SPICE', () => {
  it('parses SPICE engineering suffixes (m = milli, meg = mega)', () => {
    expect(spiceNumber('1k')).toBe(1000);
    expect(spiceNumber('10m')).toBeCloseTo(0.01, 12);
    expect(spiceNumber('2MEG')).toBe(2e6);
    expect(spiceNumber('100nF')).toBeCloseTo(1e-7, 15);
  });

  it('imports a netlist with exact connectivity and simulates it', () => {
    const net = `divider test\nV1 in 0 DC 12\nR1 in out 2k\nR2 out 0 1k\n.op\n.end\n`;
    const r = importSpice(net);
    expect(r.imported).toBe(3);
    expect(r.skipped).toEqual([]);
    const op = runOperatingPoint(r.project) as OpResult;
    expect(op.ok).toBe(true);
    expect(op.nodeVoltages.out).toBeCloseTo(4, 6); // 1 pS node shunts limit agreement to ~1e-9
  });

  it('export → import round trip preserves the operating point', () => {
    const p = EXAMPLES.find((e) => e.id === 'kirchhoff')!.build();
    const a = runOperatingPoint(p) as OpResult;
    const back = importSpice(toSpice(p));
    const b = runOperatingPoint(back.project) as OpResult;
    const va = Object.values(a.components).find((x) => x.voltage !== undefined && Math.abs(x.voltage - 75 / 11) < 1e-6);
    expect(va).toBeTruthy();
    const vals = Object.values(b.nodeVoltages);
    expect(vals.some((v) => Math.abs(v - 75 / 11) < 1e-6)).toBe(true);
  });

  it('reports unsupported elements instead of guessing', () => {
    const r = importSpice('t\nX1 a b sub\nE1 a 0 b 0 2\nR1 a 0 1k\n.end\n');
    expect(r.imported).toBe(1);
    expect(r.skipped.map((s) => s.text)).toEqual(['X1 a b sub', 'E1 a 0 b 0 2']);
  });
});
