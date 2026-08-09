/** "HH:MM" <-> 0時からの通算分 の変換ヘルパー */

export function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHHMM(min: number): string {
  const v = Math.round(min);
  const h = Math.floor(((v % 1440) + 1440) % 1440 / 60);
  const mm = ((v % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function todayLabel(d = new Date()): string {
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
}
