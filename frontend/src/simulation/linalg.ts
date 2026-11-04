/** Dense LU solve with partial pivoting (real and complex). Circuits here are small (<~500 unknowns). */

export class SingularMatrixError extends Error {
  constructor(public readonly row: number) {
    super(`Singular circuit matrix at unknown ${row}`);
  }
}

export function solveReal(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const M = A.map((r) => Float64Array.from(r));
  const x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i][k]);
      if (v > max) {
        max = v;
        piv = i;
      }
    }
    if (max < 1e-300) throw new SingularMatrixError(k);
    if (piv !== k) {
      [M[k], M[piv]] = [M[piv], M[k]];
      const t = x[k];
      x[k] = x[piv];
      x[piv] = t;
    }
    const rk = M[k];
    const d = rk[k];
    for (let i = k + 1; i < n; i++) {
      const ri = M[i];
      const f = ri[k] / d;
      if (f === 0) continue;
      ri[k] = 0;
      for (let j = k + 1; j < n; j++) ri[j] -= f * rk[j];
      x[i] -= f * x[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    const ri = M[i];
    for (let j = i + 1; j < n; j++) s -= ri[j] * x[j];
    x[i] = s / ri[i];
  }
  return x;
}

/** Complex solve: A = Ar + j·Ai, b = br + j·bi. */
export function solveComplex(Ar: Float64Array[], Ai: Float64Array[], br: Float64Array, bi: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = br.length;
  const R = Ar.map((r) => Float64Array.from(r));
  const I = Ai.map((r) => Float64Array.from(r));
  const xr = Float64Array.from(br);
  const xi = Float64Array.from(bi);
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.hypot(R[k][k], I[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.hypot(R[i][k], I[i][k]);
      if (v > max) {
        max = v;
        piv = i;
      }
    }
    if (max < 1e-300) throw new SingularMatrixError(k);
    if (piv !== k) {
      [R[k], R[piv]] = [R[piv], R[k]];
      [I[k], I[piv]] = [I[piv], I[k]];
      [xr[k], xr[piv]] = [xr[piv], xr[k]];
      [xi[k], xi[piv]] = [xi[piv], xi[k]];
    }
    const dr = R[k][k];
    const di = I[k][k];
    const dd = dr * dr + di * di;
    for (let i = k + 1; i < n; i++) {
      const ar = R[i][k];
      const ai = I[i][k];
      if (ar === 0 && ai === 0) continue;
      // f = a / d
      const fr = (ar * dr + ai * di) / dd;
      const fi = (ai * dr - ar * di) / dd;
      for (let j = k; j < n; j++) {
        const kr = R[k][j];
        const ki = I[k][j];
        R[i][j] -= fr * kr - fi * ki;
        I[i][j] -= fr * ki + fi * kr;
      }
      const br2 = xr[k];
      const bi2 = xi[k];
      xr[i] -= fr * br2 - fi * bi2;
      xi[i] -= fr * bi2 + fi * br2;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let sr = xr[i];
    let si = xi[i];
    for (let j = i + 1; j < n; j++) {
      sr -= R[i][j] * xr[j] - I[i][j] * xi[j];
      si -= R[i][j] * xi[j] + I[i][j] * xr[j];
    }
    const dr = R[i][i];
    const di = I[i][i];
    const dd = dr * dr + di * di;
    xr[i] = (sr * dr + si * di) / dd;
    xi[i] = (si * dr - sr * di) / dd;
  }
  return { re: xr, im: xi };
}
