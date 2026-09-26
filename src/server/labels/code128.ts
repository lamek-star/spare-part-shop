/** Code 128 (subset B) encoder: printable ASCII, no dependencies. */
export const PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];
const START_B = 104;
const STOP = 106;

export function code128Values(text: string): number[] {
  if (!text || text.length > 80)
    throw new Error("A barcode needs 1 to 80 characters.");
  const values = [START_B];
  let sum = START_B;
  for (const [i, ch] of [...text].entries()) {
    const code = ch.codePointAt(0)!;
    if (code < 32 || code > 126)
      throw new Error("Barcodes can only carry plain printable characters.");
    const v = code - 32;
    values.push(v);
    sum += v * (i + 1);
  }
  values.push(sum % 103, STOP);
  return values;
}
/** Alternating bar/space module widths, starting with a bar. */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]].map(Number));
}
export function code128Svg(
  text: string,
  opts: { moduleWidth?: number; height?: number; caption?: boolean } = {},
): string {
  const mw = opts.moduleWidth ?? 2;
  const height = opts.height ?? 60;
  const quiet = 10 * mw;
  const widths = code128Widths(text);
  const total = widths.reduce((a, b) => a + b, 0) * mw + quiet * 2;
  let x = quiet;
  let bars = "";
  widths.forEach((w, i) => {
    if (i % 2 === 0)
      bars += `<rect x="${x}" y="0" width="${w * mw}" height="${height}"/>`;
    x += w * mw;
  });
  const esc = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const caption =
    opts.caption === false
      ? ""
      : `<text x="${total / 2}" y="${height + 14}" text-anchor="middle" font-family="monospace" font-size="12">${esc}</text>`;
  const h = height + (opts.caption === false ? 0 : 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h}" width="${total}" height="${h}" role="img" aria-label="Barcode ${esc}"><rect width="${total}" height="${h}" fill="#fff"/><g fill="#000">${bars}</g>${caption}</svg>`;
}
