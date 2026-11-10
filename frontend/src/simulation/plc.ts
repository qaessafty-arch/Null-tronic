/**
 * Minimal IEC 61131-3 Structured Text interpreter for Boolean PLC logic (vendor-neutral).
 *
 * Supported: assignments `Q0.0 := expr;`, `IF expr THEN ... [ELSIF expr THEN ...] [ELSE ...] END_IF;`,
 * operators NOT, AND (&), XOR, OR, parentheses, TRUE/FALSE, comments (* ... *) and // ...
 * Variables: inputs %I / I (I0.0), outputs %Q / Q (Q0.0), memory %M / M or any identifier.
 * Function blocks (declared in VAR ... END_VAR): TON / TOF timers and CTU up-counter, e.g.
 *   VAR T1 : TON; C1 : CTU; END_VAR
 *   T1(IN := I0.0, PT := T#2s);  C1(CU := I0.1, R := I0.2, PV := 3);  Q0.0 := T1.Q AND C1.Q;
 * Only the Boolean output .Q is readable. Timers use simulation time (transient analysis).
 * Not supported (reported as a parse error): arithmetic, comparisons, other function blocks.
 * Each scan executes statements in order; assignments take effect immediately (as on a PLC).
 */

export type Expr =
  | { k: 'const'; v: boolean }
  | { k: 'var'; name: string }
  | { k: 'not'; e: Expr }
  | { k: 'bin'; op: 'AND' | 'OR' | 'XOR'; a: Expr; b: Expr };

export type FbType = 'TON' | 'TOF' | 'CTU';

export type Stmt =
  | { k: 'assign'; target: string; e: Expr }
  | { k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; otherwise: Stmt[] }
  /** Function-block call. `pt` in seconds (timers), `pv` preset count (CTU), `reset` optional (CTU). */
  | { k: 'fb'; name: string; type: FbType; input: Expr; reset: Expr | null; pt: number; pv: number };

/** Retained state of one function-block instance. */
export interface FbState {
  q: boolean;
  /** TON: time IN went true; TOF: time IN went false (null = not timing). */
  start: number | null;
  prevIn: boolean;
  cv: number;
}
export type PlcMemory = Map<string, FbState>;

export interface PlcProgram {
  statements: Stmt[];
  /** Normalised names of everything assigned (outputs and memory). */
  written: Set<string>;
  read: Set<string>;
  /** Declared function-block instances (name → type). */
  fbs: Map<string, FbType>;
}

export class PlcSyntaxError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`line ${line}: ${message}`);
  }
}

/** I0.0, %I0.0, i0.0 → "I0.0"; other identifiers upper-cased. */
export function normaliseAddress(s: string): string {
  return s.replace(/^%/, '').toUpperCase();
}

interface Tok {
  t: string;
  line: number;
  /** numeric value for '#time' (seconds) and '#num' tokens */
  v?: number;
}

const KEYWORDS = new Set(['AND', 'OR', 'XOR', 'NOT', 'TRUE', 'FALSE', 'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF', 'VAR', 'END_VAR']);
const FB_TYPES = new Set(['TON', 'TOF', 'CTU']);
const TIME_UNITS: Record<string, number> = { ms: 1e-3, s: 1, m: 60, h: 3600 };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith('(*', i)) {
      const end = src.indexOf('*)', i + 2);
      if (end < 0) throw new PlcSyntaxError('unterminated comment', line);
      line += (src.slice(i, end).match(/\n/g) ?? []).length;
      i = end + 2;
      continue;
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith(':=', i)) {
      out.push({ t: ':=', line });
      i += 2;
      continue;
    }
    if ('();&:,'.includes(c)) {
      out.push({ t: c === '&' ? 'AND' : c, line });
      i++;
      continue;
    }
    const tm = /^(?:T|TIME)#((?:\d+(?:\.\d+)?(?:ms|s|m|h))+)/i.exec(src.slice(i));
    if (tm) {
      let sec = 0;
      for (const part of tm[1].toLowerCase().matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) sec += parseFloat(part[1]) * TIME_UNITS[part[2]];
      out.push({ t: '#time', line, v: sec });
      i += tm[0].length;
      continue;
    }
    const m = /^%?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?/.exec(src.slice(i));
    if (m) {
      const w = m[0].toUpperCase();
      out.push({ t: KEYWORDS.has(w) ? w : normaliseAddress(m[0]), line });
      i += m[0].length;
      continue;
    }
    const nm = /^\d+/.exec(src.slice(i));
    if (nm) {
      out.push({ t: '#num', line, v: parseInt(nm[0], 10) });
      i += nm[0].length;
      continue;
    }
    throw new PlcSyntaxError(`unexpected character "${c}"`, line);
  }
  return out;
}

export function compilePlc(src: string): PlcProgram {
  const toks = tokenize(src);
  let p = 0;
  const written = new Set<string>();
  const read = new Set<string>();
  const peek = () => toks[p]?.t;
  const line = () => toks[Math.min(p, toks.length - 1)]?.line ?? 1;
  const expect = (t: string) => {
    if (toks[p]?.t !== t) throw new PlcSyntaxError(`expected "${t}" but found "${toks[p]?.t ?? 'end of program'}"`, line());
    p++;
  };
  const isIdent = (t: string | undefined) => !!t && !KEYWORDS.has(t) && !['(', ')', ';', ':=', ':', ',', '#time', '#num'].includes(t);
  const fbs = new Map<string, FbType>();
  /** Check a name used as a variable: `T1.Q` must refer to a declared block; plain names must not be blocks. */
  const checkVar = (name: string, writing: boolean) => {
    const dot = name.indexOf('.');
    const base = dot < 0 ? name : name.slice(0, dot);
    if (fbs.has(base)) {
      if (dot < 0) throw new PlcSyntaxError(`${base} is a ${fbs.get(base)} function block: call it as ${base}(...) and read ${base}.Q`, line());
      if (name.slice(dot + 1) !== 'Q') throw new PlcSyntaxError(`only the Boolean output ${base}.Q can be read (found ${name})`, line());
      if (writing) throw new PlcSyntaxError(`cannot assign to function-block output ${name}`, line());
    } else if (dot >= 0 && !/^\d+$/.test(name.slice(dot + 1))) {
      throw new PlcSyntaxError(`unknown function block "${base}" (declare it: VAR ${base} : TON; END_VAR)`, line());
    }
  };

  const primary = (): Expr => {
    const t = peek();
    if (t === '(') {
      p++;
      const e = orExpr();
      expect(')');
      return e;
    }
    if (t === 'TRUE' || t === 'FALSE') {
      p++;
      return { k: 'const', v: t === 'TRUE' };
    }
    if (t === 'NOT') {
      p++;
      return { k: 'not', e: primary() };
    }
    if (t === '#num' || t === '#time') throw new PlcSyntaxError('numbers are not supported in Boolean expressions (use them only as PT / PV of a function block)', line());
    if (isIdent(t)) {
      checkVar(t!, false);
      p++;
      read.add(t!);
      return { k: 'var', name: t! };
    }
    throw new PlcSyntaxError(`expected an operand but found "${t ?? 'end of program'}"`, line());
  };
  const level = (op: 'AND' | 'XOR' | 'OR', next: () => Expr) => (): Expr => {
    let a = next();
    while (peek() === op) {
      p++;
      a = { k: 'bin', op, a, b: next() };
    }
    return a;
  };
  const andExpr = level('AND', primary);
  const xorExpr = level('XOR', andExpr);
  const orExpr: () => Expr = level('OR', xorExpr);

  const declarations = () => {
    while (peek() === 'VAR') {
      p++;
      while (peek() !== 'END_VAR') {
        const names: string[] = [];
        for (;;) {
          const n = peek();
          if (!isIdent(n) || n!.includes('.')) throw new PlcSyntaxError(`expected a variable name in VAR block but found "${n ?? 'end of program'}"`, line());
          if (/^[IQ]\d/.test(n!)) throw new PlcSyntaxError(`${n} is an I/O address and cannot be declared`, line());
          names.push(n!);
          p++;
          if (peek() !== ',') break;
          p++;
        }
        expect(':');
        const type = peek();
        if (type === 'BOOL') {
          p++; // plain Boolean memory: declaration accepted, nothing to record
        } else if (type && FB_TYPES.has(type)) {
          p++;
          for (const n of names) {
            if (fbs.has(n)) throw new PlcSyntaxError(`${n} is declared twice`, line());
            fbs.set(n, type as FbType);
          }
        } else throw new PlcSyntaxError(`unsupported type "${type ?? 'end of program'}" (supported: BOOL, TON, TOF, CTU)`, line());
        expect(';');
      }
      expect('END_VAR');
    }
  };
  const fbCall = (name: string): Stmt => {
    const type = fbs.get(name)!;
    const at = line();
    p++; // name
    expect('(');
    let input: Expr | null = null;
    let reset: Expr | null = null;
    let pt = NaN;
    let pv = NaN;
    while (peek() !== ')') {
      const param = peek();
      if (!isIdent(param)) throw new PlcSyntaxError(`expected a parameter name in ${name}(...) but found "${param ?? 'end of program'}"`, line());
      p++;
      expect(':=');
      const inName = type === 'CTU' ? 'CU' : 'IN';
      if (param === inName) input = orExpr();
      else if (type === 'CTU' && (param === 'R' || param === 'RESET')) reset = orExpr();
      else if (type !== 'CTU' && param === 'PT') {
        if (peek() !== '#time') throw new PlcSyntaxError(`PT of ${name} must be a time literal such as T#2s or T#500ms`, line());
        pt = toks[p++].v!;
      } else if (type === 'CTU' && param === 'PV') {
        if (peek() !== '#num') throw new PlcSyntaxError(`PV of ${name} must be a whole number`, line());
        pv = toks[p++].v!;
      } else throw new PlcSyntaxError(`${type} ${name} has no parameter "${param}" (${type === 'CTU' ? 'CU, R, PV' : 'IN, PT'})`, line());
      if (peek() === ',') p++;
      else if (peek() !== ')') throw new PlcSyntaxError(`expected "," or ")" in ${name}(...) but found "${peek() ?? 'end of program'}"`, line());
    }
    expect(')');
    expect(';');
    if (!input) throw new PlcSyntaxError(`${type} ${name} needs ${type === 'CTU' ? 'CU' : 'IN'} := <expression>`, at);
    if (type === 'CTU' ? !(pv >= 1) : !(pt >= 0)) throw new PlcSyntaxError(`${type} ${name} needs ${type === 'CTU' ? 'PV := <count ≥ 1>' : 'PT := T#<time>'}`, at);
    return { k: 'fb', name, type, input, reset, pt, pv };
  };

  const statements = (stop: Set<string>): Stmt[] => {
    const list: Stmt[] = [];
    while (p < toks.length && !stop.has(peek()!)) {
      if (fbs.has(peek()!) && toks[p + 1]?.t === '(') {
        list.push(fbCall(peek()!));
        continue;
      }
      if (peek() === 'IF') {
        p++;
        const branches: { cond: Expr; body: Stmt[] }[] = [];
        const cond = orExpr();
        expect('THEN');
        branches.push({ cond, body: statements(new Set(['ELSIF', 'ELSE', 'END_IF'])) });
        let otherwise: Stmt[] = [];
        while (peek() === 'ELSIF') {
          p++;
          const c = orExpr();
          expect('THEN');
          branches.push({ cond: c, body: statements(new Set(['ELSIF', 'ELSE', 'END_IF'])) });
        }
        if (peek() === 'ELSE') {
          p++;
          otherwise = statements(new Set(['END_IF']));
        }
        expect('END_IF');
        expect(';');
        list.push({ k: 'if', branches, otherwise });
        continue;
      }
      const target = peek();
      if (!isIdent(target)) throw new PlcSyntaxError(`expected an assignment target but found "${target}"`, line());
      if (/^I\d/.test(target!)) throw new PlcSyntaxError(`cannot assign to input ${target}`, line());
      checkVar(target!, true);
      p++;
      expect(':=');
      const e = orExpr();
      expect(';');
      written.add(target!);
      list.push({ k: 'assign', target: target!, e });
    }
    return list;
  };
  declarations();
  const stmts = statements(new Set());
  return { statements: stmts, written, read, fbs };
}

export function evalExpr(e: Expr, env: Map<string, boolean>): boolean {
  switch (e.k) {
    case 'const':
      return e.v;
    case 'var':
      return env.get(e.name) ?? false;
    case 'not':
      return !evalExpr(e.e, env);
    case 'bin': {
      const a = evalExpr(e.a, env);
      const b = evalExpr(e.b, env);
      return e.op === 'AND' ? a && b : e.op === 'OR' ? a || b : a !== b;
    }
  }
}

/** Execute one function-block call at simulation time `t` (seconds). Idempotent for repeated scans at the same `t`. */
export function runFb(s: Extract<Stmt, { k: 'fb' }>, st: FbState, env: Map<string, boolean>, t: number): void {
  const input = evalExpr(s.input, env);
  if (s.type === 'TON') {
    if (!input) st.start = null;
    else if (st.start === null) st.start = t;
    st.q = input && t - st.start! >= s.pt - 1e-12;
  } else if (s.type === 'TOF') {
    if (input) st.start = null;
    else if (st.prevIn) st.start = t;
    st.q = input || (st.start !== null && t - st.start < s.pt - 1e-12);
  } else {
    if (s.reset && evalExpr(s.reset, env)) st.cv = 0;
    else if (input && !st.prevIn) st.cv++;
    st.q = st.cv >= s.pv;
  }
  st.prevIn = input;
}

/**
 * One PLC scan. `env` holds inputs plus retained outputs/memory; it is updated in place.
 * `time` is the simulation time in seconds and `mem` the retained function-block state.
 */
export function scan(prog: PlcProgram, env: Map<string, boolean>, time = 0, mem: PlcMemory = new Map()): void {
  for (const name of prog.fbs.keys()) {
    if (!mem.has(name)) mem.set(name, { q: false, start: null, prevIn: false, cv: 0 });
    env.set(`${name}.Q`, mem.get(name)!.q);
  }
  const run = (list: Stmt[]) => {
    for (const s of list) {
      if (s.k === 'assign') env.set(s.target, evalExpr(s.e, env));
      else if (s.k === 'fb') {
        const st = mem.get(s.name)!;
        runFb(s, st, env, time);
        env.set(`${s.name}.Q`, st.q);
      } else {
        const hit = s.branches.find((b) => evalExpr(b.cond, env));
        run(hit ? hit.body : s.otherwise);
      }
    }
  };
  run(prog.statements);
}
