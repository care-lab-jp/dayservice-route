/**
 * 月次モニタリングの計算（純粋関数・外部通信なし）。
 *
 * ・目標は「期間つきの履歴」として持ち、その月に有効な目標を選ぶ
 * ・記録には作成時点の目標を写して保存するので、あとから目標を変えても過去は変わらない
 * ・短期目標の終了日は「開始日から6か月間」として自動計算する（手動修正も可）
 */
import type {
  MonitoringGoalAssessment, MonitoringGoalKind, MonitoringGoalTerm, MonitoringMonthlyRecord,
} from '../types';

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type MonthNumber = (typeof MONTHS)[number];

export const monthLabel = (m: number) => `${m}月`;

/** 様式のシート名（原本と同じ「西暦,月」形式） */
export const sheetNameOf = (year: number, month: number) => `${year},${month}`;

/* ---------------- 日付の計算 ---------------- */

/** "YYYY-MM-DD" を分解する。不正なら null */
export function parseDate(iso: string): { y: number; m: number; d: number } | null {
  const t = (iso ?? '').trim();
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!r) return null;
  const y = Number(r[1]), m = Number(r[2]), d = Number(r[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** その年月の日数 */
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * 開始日から「Nか月間」の終了日を返す。
 * 例：2026-04-01 から6か月 → 2026-09-30（翌月同日の前日）
 *     2026-08-31 から6か月 → 2027-02-28（月末を超える場合は月末に丸める）
 */
export function addMonthsAsPeriodEnd(startIso: string, months: number): string {
  const p = parseDate(startIso);
  if (!p) return '';
  // 開始日の「Nか月後の同日」の前日を終了日とする
  let y = p.y;
  let m = p.m + months;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  const day = Math.min(p.d, daysInMonth(y, m));
  const dt = new Date(y, m - 1, day);
  dt.setDate(dt.getDate() - 1);
  return toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** 短期目標の終了日（開始日から6か月間） */
export const shortTermEndDate = (startIso: string) => addMonthsAsPeriodEnd(startIso, 6);

/** その月の初日・末日 */
export function monthRange(year: number, month: number): { from: string; to: string } {
  return { from: toIso(year, month, 1), to: toIso(year, month, daysInMonth(year, month)) };
}

/* ---------------- 目標の履歴 ---------------- */

/** 期間が日付を含むか（終了日が空なら「以降ずっと」とみなす） */
export function coversDate(term: MonitoringGoalTerm, iso: string): boolean {
  const start = (term.startDate ?? '').trim();
  const end = (term.endDate ?? '').trim();
  if (!start) return false;
  if (iso < start) return false;
  if (end && iso > end) return false;
  return true;
}

/**
 * 指定の年月に有効な目標を返す。
 * 月のどこか1日でも期間に入っていれば対象とし、複数あれば開始日が新しいものを採る。
 */
export function goalForMonth(
  terms: MonitoringGoalTerm[],
  memberId: string,
  kind: MonitoringGoalKind,
  year: number,
  month: number
): MonitoringGoalTerm | null {
  const { from, to } = monthRange(year, month);
  const candidates = terms
    .filter((t) => t.memberId === memberId && t.kind === kind)
    .filter((t) => {
      const start = (t.startDate ?? '').trim();
      const end = (t.endDate ?? '').trim();
      if (!start) return false;
      // 期間と月が重なっているか
      return start <= to && (!end || end >= from);
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return candidates[0] ?? null;
}

/** 指定日に有効な目標 */
export function goalOnDate(
  terms: MonitoringGoalTerm[],
  memberId: string,
  kind: MonitoringGoalKind,
  iso: string
): MonitoringGoalTerm | null {
  return (
    terms
      .filter((t) => t.memberId === memberId && t.kind === kind && coversDate(t, iso))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null
  );
}

/** 目標の履歴（新しい順） */
export function goalHistory(
  terms: MonitoringGoalTerm[],
  memberId: string,
  kind: MonitoringGoalKind
): MonitoringGoalTerm[] {
  return terms
    .filter((t) => t.memberId === memberId && t.kind === kind)
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
}

/**
 * 目標を差し替えるときに、前の目標の終了日を自動で埋める。
 * 「新しい目標の開始日の前日」を、前の目標の終了日にする。
 */
export function closePreviousTerm(prev: MonitoringGoalTerm, newStartIso: string): MonitoringGoalTerm {
  const p = parseDate(newStartIso);
  if (!p) return prev;
  const dt = new Date(p.y, p.m - 1, p.d);
  dt.setDate(dt.getDate() - 1);
  return { ...prev, endDate: toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()) };
}

/* ---------------- 月次記録 ---------------- */

export function findMonthly(
  records: MonitoringMonthlyRecord[],
  memberId: string,
  year: number,
  month: number
): MonitoringMonthlyRecord | null {
  return (
    records.find((r) => r.memberId === memberId && r.year === year && r.month === month) ?? null
  );
}

/** その年に記録がある月の一覧 */
export function monthsWithData(
  records: MonitoringMonthlyRecord[],
  memberId: string,
  year: number
): number[] {
  return records
    .filter((r) => r.memberId === memberId && r.year === year)
    .map((r) => r.month)
    .sort((a, b) => a - b);
}

/** 記録が空（何も入力されていない）か */
export function isEmptyMonthly(r: MonitoringMonthlyRecord): boolean {
  const a = r.longTerm ?? {};
  const b = r.shortTerm ?? {};
  const filled = [
    r.implementedOn, r.monitorName,
    a.implementation, a.achievement, a.satisfaction, a.direction, a.reason,
    b.implementation, b.achievement, b.satisfaction, b.direction, b.reason,
  ].some((v) => (v ?? '').toString().trim().length > 0);
  return !filled;
}

/** 実施者の候補（過去に使った名前を、新しい順・重複なしで） */
export function monitorNameSuggestions(
  records: MonitoringMonthlyRecord[],
  limit = 8
): string[] {
  const sorted = [...records].sort((a, b) =>
    (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
  );
  const out: string[] = [];
  for (const r of sorted) {
    const n = (r.monitorName ?? '').trim();
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/** 年の候補（記録がある年＋今年） */
export function availableYears(
  records: MonitoringMonthlyRecord[],
  memberId: string,
  today = new Date()
): number[] {
  const years = new Set<number>(
    records.filter((r) => r.memberId === memberId).map((r) => r.year)
  );
  years.add(today.getFullYear());
  return [...years].sort((a, b) => b - a);
}

/**
 * 指定の年月より前で、いちばん近い月の記録を返す。
 * 「前回の内容を引用する」ときの引用元になる。
 */
export function previousMonthlyRecord(
  records: MonitoringMonthlyRecord[],
  memberId: string,
  year: number,
  month: number
): MonitoringMonthlyRecord | null {
  const key = year * 100 + month;
  return (
    records
      .filter((r) => r.memberId === memberId && r.year * 100 + r.month < key)
      .sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month))[0] ?? null
  );
}

/** 前回の記録から、評価欄だけを引き写す（目標本文・実施日は引き継がない） */
export function carryOverAssessments(
  prev: MonitoringMonthlyRecord
): Pick<MonitoringMonthlyRecord, 'longTerm' | 'shortTerm'> {
  const pick = (a: MonitoringGoalAssessment = {}): MonitoringGoalAssessment => ({
    periodFrom: a.periodFrom,
    periodTo: a.periodTo,
    implementation: a.implementation,
    achievement: a.achievement,
    satisfaction: a.satisfaction,
    direction: a.direction,
    reason: a.reason,
  });
  return { longTerm: pick(prev.longTerm), shortTerm: pick(prev.shortTerm) };
}

/** 目標の期間を評価欄の期間へ写す（未設定なら空のまま） */
export function periodFromGoal(
  term: { startDate?: string; endDate?: string } | null
): { periodFrom?: string; periodTo?: string } {
  if (!term) return {};
  return {
    periodFrom: (term.startDate ?? '').trim() || undefined,
    periodTo: (term.endDate ?? '').trim() || undefined,
  };
}
