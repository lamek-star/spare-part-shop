/**
 * A compact QR Code encoder: byte mode, error-correction level M,
 * versions 1-10 (up to 213 bytes). Structure follows the ISO 18004
 * algorithm (Reed-Solomon over GF(256), 8 masks scored by the standard
 * penalty rules). Verified against an independent implementation in the
 * test suite.
 */
const ECC_CODEWORDS_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
// [blocks in group 1, data codewords in group 1 blocks, blocks in group 2, data codewords in group 2 blocks]
const BLOCKS: Record<number, [number, number, number, number]> = {
  1: [1, 16, 0, 0],
  2: [1, 28, 0, 0],
  3: [1, 44, 0, 0],
  4: [2, 32, 0, 0],
  5: [2, 43, 0, 0],
  6: [4, 27, 0, 0],
  7: [4, 31, 0, 0],
  8: [2, 38, 2, 39],
  9: [3, 36, 2, 37],
  10: [4, 43, 1, 44],
};
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};
export const MAX_QR_BYTES = 213;

// ---- Reed-Solomon over GF(256), polynomial 0x11D
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a: number, b: number) =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gmul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly; // highest degree first, leading 1
}
function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gmul(gen[i + 1], factor);
  }
  return rem;
}

function bch(value: number, poly: number, bits: number): number {
  let rem = value;
  const degree = Math.floor(Math.log2(poly));
  for (let i = 0; i < bits; i++)
    rem = (rem << 1) ^ ((rem >>> (degree - 1)) * poly);
  return rem;
}

export function qrMatrix(text: string): boolean[][] {
  const data = [...new TextEncoder().encode(text)];
  if (!data.length) throw new Error("A QR code needs some text.");
  if (data.length > MAX_QR_BYTES)
    throw new Error(
      `Too long for a QR code (${data.length} bytes; the limit is ${MAX_QR_BYTES}).`,
    );
  let version = 1;
  for (; version <= 10; version++) {
    const [g1, d1, g2, d2] = BLOCKS[version];
    const capacityBits = (g1 * d1 + g2 * d2) * 8;
    const needed = 4 + (version < 10 ? 8 : 16) + data.length * 8;
    if (needed <= capacityBits) break;
  }
  const [g1, d1, g2, d2] = BLOCKS[version];
  const dataCodewords = g1 * d1 + g2 * d2;

  // ---- bit stream
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(data.length, version < 10 ? 8 : 16);
  for (const b of data) put(b, 8);
  put(0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    codewords.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; codewords.length < dataCodewords; pad ^= 0xec ^ 0x11)
    codewords.push(pad);

  // ---- blocks + error correction, interleaved
  const eccLen = ECC_CODEWORDS_PER_BLOCK[version];
  const blocks: { data: number[]; ecc: number[] }[] = [];
  let at = 0;
  for (const [count, size] of [
    [g1, d1],
    [g2, d2],
  ] as const)
    for (let i = 0; i < count; i++) {
      const chunk = codewords.slice(at, at + size);
      at += size;
      blocks.push({ data: chunk, ecc: rsRemainder(chunk, eccLen) });
    }
  const stream: number[] = [];
  for (let i = 0; i < Math.max(d1, d2); i++)
    for (const b of blocks) if (i < b.data.length) stream.push(b.data[i]);
  for (let i = 0; i < eccLen; i++)
    for (const b of blocks) stream.push(b.ecc[i]);

  // ---- matrix with function patterns
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const positions = ALIGNMENT[version];
  for (const cy of positions)
    for (const cx of positions) {
      if (
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === size - 7) ||
        (cx === size - 7 && cy === 6)
      )
        continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  // reserve format/version areas
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  set(8, size - 8, true); // the always-dark module
  if (version >= 7) {
    const info = (version << 12) | bch(version, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const bit = ((info >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // ---- place data bits in the zig-zag order
  const dataBits: number[] = [];
  for (const cw of stream)
    for (let i = 7; i >= 0; i--) dataBits.push((cw >>> i) & 1);
  let bit = 0;
  const placed: [number, number][] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        modules[y][x] = bit < dataBits.length ? dataBits[bit] === 1 : false;
        bit++;
        placed.push([x, y]);
      }
  }

  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const withMask = (mask: number): boolean[][] => {
    const m = modules.map((row) => [...row]);
    for (const [x, y] of placed) if (maskFn[mask](x, y)) m[y][x] = !m[y][x];
    const format = (0b00 << 3) | mask; // level M = 00
    const bitsF = ((format << 10) | bch(format, 0x537, 10)) ^ 0x5412;
    const fb = (i: number) => ((bitsF >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) m[i][8] = fb(i);
    m[7][8] = fb(6);
    m[8][8] = fb(7);
    m[8][7] = fb(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = fb(i);
    for (let i = 0; i < 8; i++) m[8][size - 1 - i] = fb(i);
    for (let i = 8; i < 15; i++) m[size - 15 + i][8] = fb(i);
    m[size - 8][8] = true;
    return m;
  };
  const penalty = (m: boolean[][]): number => {
    let score = 0;
    const runs = (line: boolean[]) => {
      let s = 0;
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) s += run - 2;
          run = 1;
        }
      }
      return s;
    };
    const pattern = (line: boolean[]) => {
      let s = 0;
      const a = [
        true,
        false,
        true,
        true,
        true,
        false,
        true,
        false,
        false,
        false,
        false,
      ];
      const b = [
        false,
        false,
        false,
        false,
        true,
        false,
        true,
        true,
        true,
        false,
        true,
      ];
      for (let i = 0; i + 11 <= line.length; i++) {
        const w = line.slice(i, i + 11);
        if (w.every((v, k) => v === a[k])) s += 40;
        if (w.every((v, k) => v === b[k])) s += 40;
      }
      return s;
    };
    for (let y = 0; y < size; y++) {
      score += runs(m[y]) + pattern(m[y]);
      const col = m.map((row) => row[y]);
      score += runs(col) + pattern(col);
    }
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++)
        if (
          m[y][x] === m[y][x + 1] &&
          m[y][x] === m[y + 1][x] &&
          m[y][x] === m[y + 1][x + 1]
        )
          score += 3;
    const dark = m.flat().filter(Boolean).length;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  };
  let best = withMask(0);
  let bestScore = penalty(best);
  for (let mask = 1; mask < 8; mask++) {
    const m = withMask(mask);
    const s = penalty(m);
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

export function qrSvg(
  text: string,
  opts: { scale?: number; quiet?: number; caption?: string } = {},
): string {
  const m = qrMatrix(text);
  const scale = opts.scale ?? 6;
  const quiet = opts.quiet ?? 4;
  const dim = (m.length + quiet * 2) * scale;
  let path = "";
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark)
        path += `M${(x + quiet) * scale} ${(y + quiet) * scale}h${scale}v${scale}h-${scale}z`;
    }),
  );
  const esc = (opts.caption ?? "").replace(
    /[&<>"']/g,
    (c) => `&#${c.charCodeAt(0)};`,
  );
  const cap = esc
    ? `<text x="${dim / 2}" y="${dim + 14}" text-anchor="middle" font-family="monospace" font-size="12">${esc}</text>`
    : "";
  const h = dim + (esc ? 20 : 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${h}" width="${dim}" height="${h}" role="img" aria-label="QR code"><rect width="${dim}" height="${h}" fill="#fff"/><path d="${path}" fill="#000"/>${cap}</svg>`;
}
