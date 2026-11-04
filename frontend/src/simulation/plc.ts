/**
 * Minimal IEC 61131-3 Structured Text interpreter for Boolean PLC logic (vendor-neutral).
 *
 * Supported: assignments `Q0.0 := expr;`, `IF expr THEN ... [ELSIF expr THEN ...] [ELSE ...] END_IF;`,
 * operators NOT, AND (&), XOR, OR, parentheses, TRUE/FALSE, comments (* ... *) and // ...
 * Variables: inputs %I / I (I0.0), outputs %Q / Q (Q0.0), memory %M / M or any identifier.
 * Not supported (reported as a parse error): timers, counters, arithmetic, function blocks.
 * Each scan executes statements in order; assignments take effect immediately (as on a PLC).
 */

export type Expr =
  | { k: 'const'; v: boolean }
  | { k: 'var'; name: string }
  | { k: 'not'; e: Expr }
  | { k: 'bin'; op: 'AND' | 'OR' | 'XOR'; a: Expr; b: Expr };

export type Stmt = { k: 'assign'; target: string; e: Expr } | { k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; otherwise: Stmt[] };

export interface PlcProgram {
  statements: Stmt[];
  /** Normalised names of everything assigned (outputs and memory). */
  written: Set<string>;
  read: Set<string>;
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
}

const KEYWORDS = new Set(['AND', 'OR', 'XOR', 'NOT', 'TRUE', 'FALSE', 'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF']);

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
    if ('();&'.includes(c)) {
      out.push({ t: c === '&' ? 'AND' : c, line });
      i++;
      continue;
    }
    const m = /^%?[A-Za-z_][A-Za-z0-9_]*(?:\.[0-9]+)?/.exec(src.slice(i));
    if (m) {
      const w = m[0].toUpperCase();
      out.push({ t: KEYWORDS.has(w) ? w : normaliseAddress(m[0]), line });
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(c)) throw new PlcSyntaxError(`numbers are not supported (Boolean logic only): "${src.slice(i, i + 8)}"`, line);
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
  const isIdent = (t: string | undefined) => !!t && !KEYWORDS.has(t) && !['(', ')', ';', ':='].includes(t);

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
    if (isIdent(t)) {
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

  const statements = (stop: Set<string>): Stmt[] => {
    const list: Stmt[] = [];
    while (p < toks.length && !stop.has(peek()!)) {
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
      p++;
      expect(':=');
      const e = orExpr();
      expect(';');
      written.add(target!);
      list.push({ k: 'assign', target: target!, e });
    }
    return list;
  };
  const stmts = statements(new Set());
  return { statements: stmts, written, read };
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

/** One PLC scan. `env` holds inputs plus retained outputs/memory; it is updated in place. */
export function scan(prog: PlcProgram, env: Map<string, boolean>): void {
  const run = (list: Stmt[]) => {
    for (const s of list) {
      if (s.k === 'assign') env.set(s.target, evalExpr(s.e, env));
      else {
        const hit = s.branches.find((b) => evalExpr(b.cond, env));
        run(hit ? hit.body : s.otherwise);
      }
    }
  };
  run(prog.statements);
}
