import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function hasNgspice(): boolean {
  try {
    execFileSync('ngspice', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Run an operating point in ngspice and return lower-cased node voltages / branch currents. */
export function ngspiceOp(netlist: string): Record<string, number> {
  const body = netlist.replace(/^\.op\s*$/m, '').replace(/^\.end\s*$/m, '');
  const deck = `${body}\n.control\nop\nprint all\nprint all > /dev/null\n.endc\n.end\n`;
  const dir = mkdtempSync(join(tmpdir(), 'ntcs-'));
  const file = join(dir, 'deck.cir');
  writeFileSync(file, deck);
  const out = execFileSync('ngspice', ['-b', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const res: Record<string, number> = {};
  for (const line of out.split('\n')) {
    const m = /^\s*([^\s=]+)\s*=\s*([-+0-9.eE]+)\s*$/.exec(line);
    if (m) res[m[1].toLowerCase()] = parseFloat(m[2]);
  }
  return res;
}

/** Run a transient in ngspice and return time + named vectors (wrdata output). */
export function ngspiceTran(netlist: string, vectors: string[]): { time: number[]; data: Record<string, number[]> } {
  const body = netlist.replace(/^\.tran.*$/m, '').replace(/^\.end\s*$/m, '');
  const tranLine = /^\.tran.*$/m.exec(netlist)?.[0] ?? '';
  const dir = mkdtempSync(join(tmpdir(), 'ntcs-'));
  const outFile = join(dir, 'out.txt');
  const deck = `${body}\n.control\n${tranLine.slice(1)}\nset wr_singlescale\nwrdata ${outFile} ${vectors.join(' ')}\n.endc\n.end\n`;
  const file = join(dir, 'deck.cir');
  writeFileSync(file, deck);
  execFileSync('ngspice', ['-b', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const text = execFileSync('cat', [outFile], { encoding: 'utf8' });
  const time: number[] = [];
  const data: Record<string, number[]> = Object.fromEntries(vectors.map((v) => [v, [] as number[]]));
  for (const line of text.trim().split('\n')) {
    const cols = line.trim().split(/\s+/).map(Number);
    if (cols.some((c) => Number.isNaN(c))) continue;
    time.push(cols[0]);
    vectors.forEach((v, i) => data[v].push(cols[i + 1]));
  }
  return { time, data };
}

export function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] >= x) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[xs.length - 1];
}
