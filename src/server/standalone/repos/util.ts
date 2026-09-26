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
