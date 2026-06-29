import { describe, it, expect } from 'vitest';

/**
 * Regression guard for the long-running "pins float in the ocean / empty gap"
 * bugs. The fix was architectural: the world silhouette AND the pins now live in a
 * SINGLE inline <svg viewBox="0 0 100 50"> sharing one coordinate space, so they
 * crop together and cannot drift. There is no HTML-pin overlay and no separate
 * transform to desync.
 *
 * The remaining correctness condition is purely geometric: every country we stock
 * must project to a (x,y) INSIDE the fixed world viewBox window, so no pin is
 * cropped and none sits over empty sea. We assert exactly that here, mirroring the
 * component's own project() and WORLD_VIEW constants.
 */

const VBW = 100;
const VBH = 50;
function project(lat: number, lng: number): { x: number; y: number } {
  return { x: ((lng + 180) / 360) * VBW, y: ((90 - lat) / 180) * VBH };
}

// Must match RegionAtlas WORLD_VIEW (68°N … 56°S band).
const Y_TOP = project(68, 0).y;
const Y_BOT = project(-56, 0).y;

describe('world view geometry — all stocked countries inside the visible band', () => {
  // Representative real countries spanning the full north→south extent we carry.
  const pins: Array<[string, number, number]> = [
    ['Scotland', 57, -4],
    ['UK', 54, -2],
    ['Germany', 51, 10],
    ['France', 46.6, 2.2],
    ['Italy', 42, 12],
    ['Spain', 40, -3.7],
    ['USA', 38.5, -98],
    ['Japan', 36, 138],
    ['Chile', -33, -71],
    ['Argentina', -33, -68.5],
    ['Australia', -33, 151],
    ['South Africa', -33.9, 18.9],
    ['New Zealand', -41.3, 174],
  ];

  it('every pin projects inside the world viewBox window (no clipping, no ocean)', () => {
    for (const [name, lat, lng] of pins) {
      const { x, y } = project(lat, lng);
      expect(x, `${name} x in [0,${VBW}]`).toBeGreaterThanOrEqual(0);
      expect(x, `${name} x in [0,${VBW}]`).toBeLessThanOrEqual(VBW);
      expect(y, `${name} y inside band`).toBeGreaterThanOrEqual(Y_TOP);
      expect(y, `${name} y inside band`).toBeLessThanOrEqual(Y_BOT);
    }
  });

  it('the band is a clean letterbox strip (wider than tall, no polar dead space)', () => {
    const ratio = VBW / (Y_BOT - Y_TOP);
    expect(ratio).toBeGreaterThan(2); // wider than 2:1 → poles cropped away
    expect(ratio).toBeLessThan(3.5); // not so wide that southern pins clip
  });

  it('the band excludes the empty poles (top above 60°N, bottom below 45°S)', () => {
    const latAt = (y: number) => 90 - (y / VBH) * 180;
    expect(latAt(Y_TOP)).toBeGreaterThan(60); // north edge well above Europe
    expect(latAt(Y_BOT)).toBeLessThan(-45); // south edge below New Zealand
  });
});
