export function pageArgs(page?: number, pageSize?: number, max = 200) {
  const size = Math.max(1, Math.min(max, Math.floor(pageSize ?? 25) || 25));
  const number = Math.max(1, Math.floor(page ?? 1) || 1);
  return { page: number, pageSize: size, offset: (number - 1) * size };
}
/** Escapes % _ \ so user text is matched literally by LIKE ... ESCAPE '\'. */
export function likeTerm(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}
export const bool = (v: unknown) => Boolean(Number(v));
/** Maps one item after another. Row loaders issue their own queries, and a
 * transaction's connection runs one statement at a time, so this is also
 * the order they would run in anyway. */
export async function mapSeq<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
  return out;
}
