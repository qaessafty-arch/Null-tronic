import { describe, expect, it } from 'vitest';
import { wallSegments } from '../../src/viewport-3d/walls';
import { makeRoom } from '../../src/project-model/installation';
import { sampleInstallation } from '../../src/education/examples';

const overlap = (s: number[], t: number[]) => {
  // collinear horizontal/vertical overlap length
  if (s[1] === s[3] && t[1] === t[3] && s[1] === t[1]) return Math.max(0, Math.min(Math.max(s[0], s[2]), Math.max(t[0], t[2])) - Math.max(Math.min(s[0], s[2]), Math.min(t[0], t[2])));
  if (s[0] === s[2] && t[0] === t[2] && s[0] === t[0]) return Math.max(0, Math.min(Math.max(s[1], s[3]), Math.max(t[1], t[3])) - Math.max(Math.min(s[1], s[3]), Math.min(t[1], t[3])));
  return 0;
};

describe('3D wall segments', () => {
  it('splits partially shared walls so no two walls overlap', () => {
    const rooms = [makeRoom('Living', 0, 0, 6000, 4500), makeRoom('Kitchen', 0, 4500, 4000, 3500), makeRoom('Hall', 4000, 4500, 3000, 3500)];
    const all = [...wallSegments(rooms).values()].flat();
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(0);
    // total wall length equals the union of all room edges
    const total = all.reduce((a, s) => a + Math.hypot(s[2] - s[0], s[3] - s[1]), 0);
    expect(total).toBe(2 * (6000 + 4500) + 3500 * 3 + 7000 + 1000);
  });

  it('sample flat has no overlapping walls', () => {
    const all = [...wallSegments(Object.values(sampleInstallation().rooms)).values()].flat();
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(0);
  });
});
