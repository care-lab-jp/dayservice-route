/**
 * 氏名の並べ替え（あいうえお順）と、五十音の行での絞り込み。
 *
 * 漢字の氏名は読みが分からないため、利用者に「ふりがな」を持たせて並べ替えのキーにする。
 * ふりがなが未入力の場合は氏名そのもので比較する（漢字は日本語の照合順で並ぶ）。
 */

/** 五十音の行 */
export const KANA_ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'] as const;
export type KanaRow = (typeof KANA_ROWS)[number];

/** 行ごとの先頭文字（濁点・半濁点・小文字を含む） */
const ROW_MAP: Record<KanaRow, string> = {
  あ: 'あいうえおぁぃぅぇぉ',
  か: 'かきくけこがぎぐげごゕゖ',
  さ: 'さしすせそざじずぜぞ',
  た: 'たちつてとだぢづでどっ',
  な: 'なにぬねの',
  は: 'はひふへほばびぶべぼぱぴぷぺぽ',
  ま: 'まみむめも',
  や: 'やゆよゃゅょ',
  ら: 'らりるれろ',
  わ: 'わをんゎ',
};

/** カタカナをひらがなに変換する（全角カタカナのみ） */
export function toHiragana(s: string): string {
  return (s ?? '').replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );
}

/** 並べ替えに使う読み。ふりがなが無ければ氏名を使う */
export function readingOf(m: { name: string; kana?: string }): string {
  const k = (m.kana ?? '').trim();
  return toHiragana(k || m.name || '').replace(/[\s　]/g, '');
}

/** その氏名が属する五十音の行。判定できない場合は null */
export function kanaRowOf(m: { name: string; kana?: string }): KanaRow | null {
  const first = readingOf(m).charAt(0);
  if (!first) return null;
  for (const row of KANA_ROWS) {
    if (ROW_MAP[row].includes(first)) return row;
  }
  return null;
}

/** 日本語として自然な順に並べる（同じ読みなら氏名で比較） */
export function compareByReading(
  a: { name: string; kana?: string },
  b: { name: string; kana?: string }
): number {
  const ra = readingOf(a);
  const rb = readingOf(b);
  const c = ra.localeCompare(rb, 'ja');
  if (c !== 0) return c;
  return (a.name ?? '').localeCompare(b.name ?? '', 'ja');
}

/** あいうえお順に並べた新しい配列を返す */
export function sortByReading<T extends { name: string; kana?: string }>(list: T[]): T[] {
  return [...list].sort(compareByReading);
}

/** 指定した行の利用者だけを取り出す。row が null なら全員 */
export function filterByRow<T extends { name: string; kana?: string }>(
  list: T[],
  row: KanaRow | null
): T[] {
  if (!row) return list;
  return list.filter((m) => kanaRowOf(m) === row);
}

/** 行ごとの人数（タブの表示に使う） */
export function countByRow<T extends { name: string; kana?: string }>(
  list: T[]
): Record<KanaRow, number> {
  const out = Object.fromEntries(KANA_ROWS.map((r) => [r, 0])) as Record<KanaRow, number>;
  list.forEach((m) => {
    const r = kanaRowOf(m);
    if (r) out[r] += 1;
  });
  return out;
}
