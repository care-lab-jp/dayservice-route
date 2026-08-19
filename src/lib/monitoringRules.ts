/**
 * モニタリング記録の入力チェックと履歴の扱い（純粋関数）。
 *
 * ・期間の妥当性（不正な期間は保存させない）
 * ・期間の重複（保存は禁止せず、警告のみ）
 * ・前回記録のコピー（元の記録は変更しない）
 *
 * UIから切り離してあるため、テストで振る舞いを固定できる。外部通信は行わない。
 */
import type { MonitoringRecord } from '../types';
import { periodLabel } from './monitoringText';

export interface PeriodValidation {
  ok: boolean;
  /** 保存できない理由（okがfalseのときのみ） */
  error?: string;
}

/** 期間の妥当性。両方入力されていること、開始日が終了日より後でないこと */
export function validatePeriod(from: string, to: string): PeriodValidation {
  const f = (from ?? '').trim();
  const t = (to ?? '').trim();
  if (!f && !t) return { ok: false, error: 'モニタリング期間（開始日・終了日）を入力してください。' };
  if (!f) return { ok: false, error: 'モニタリング期間の開始日を入力してください。' };
  if (!t) return { ok: false, error: 'モニタリング期間の終了日を入力してください。' };
  if (f > t) return { ok: false, error: '開始日が終了日より後になっています。期間をご確認ください。' };
  return { ok: true };
}

/**
 * 期間が重なっている既存記録を返す。
 * 編集中の記録自身（excludeId）は対象から外す。
 * 期間の一方でも欠けている記録は判定対象にしない。
 */
export function findOverlapping(
  records: MonitoringRecord[],
  memberId: string,
  from: string,
  to: string,
  excludeId?: string
): MonitoringRecord[] {
  const f = (from ?? '').trim();
  const t = (to ?? '').trim();
  if (!f || !t) return [];
  return records.filter((r) => {
    if (r.memberId !== memberId) return false;
    if (excludeId && r.monitoringRecordId === excludeId) return false;
    const rf = (r.periodFrom ?? '').trim();
    const rt = (r.periodTo ?? '').trim();
    if (!rf || !rt) return false;
    // 期間が1日でも重なっていれば重複とみなす
    return rf <= t && f <= rt;
  });
}

/** 重複時に表示する確認文言（保存を止めるものではない） */
export function overlapWarningMessage(overlaps: MonitoringRecord[]): string {
  const list = overlaps.map((r) => `　${periodLabel(r)}`).join('\n');
  return (
    'この利用者には、入力した期間と重なるモニタリング記録があります。\n\n' +
    list +
    '\n\nこのまま保存しますか？'
  );
}

/** 期間の新しい順（終了日→開始日→作成日）に並べる */
export function sortByPeriodDesc(records: MonitoringRecord[]): MonitoringRecord[] {
  return [...records].sort((a, b) => {
    const at = a.periodTo || a.periodFrom || a.createdAt || '';
    const bt = b.periodTo || b.periodFrom || b.createdAt || '';
    if (at !== bt) return bt.localeCompare(at);
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });
}

/**
 * 前回の記録を下敷きにした「新しい記録の下書き」を作る。
 * ・元の記録は一切変更しない（値はすべて複製する）
 * ・IDと日時は空にして、保存時に新規レコードとして扱わせる
 * ・期間は引き継がない（同じ期間で二重登録する事故を避けるため）
 *   前回と同じ期間にしたい場合は「前回期間をコピー」を使う
 */
export function copyForNewRecord(prev: MonitoringRecord, memberId: string): MonitoringRecord {
  return {
    monitoringRecordId: '',
    memberId,
    createdAt: '',
    updatedAt: '',
    periodFrom: '',
    periodTo: '',
    longTermGoal: prev.longTermGoal ?? '',
    shortTermGoal: prev.shortTermGoal ?? '',
    longTermEvaluation: prev.longTermEvaluation,
    shortTermEvaluation: prev.shortTermEvaluation,
    longTermComment: prev.longTermComment,
    shortTermComment: prev.shortTermComment,
    sourceSupportRecordId: prev.sourceSupportRecordId,
    checkedItems: [...(prev.checkedItems ?? [])],
    baseline: prev.baseline ? { ...prev.baseline } : undefined,
    current: prev.current ? { ...prev.current } : undefined,
    policy: prev.policy,
    overallComment: prev.overallComment,
    generatedText: '',
  };
}

/** 一覧に出す1行ぶんの見出し情報 */
export function historySummary(r: MonitoringRecord): {
  period: string;
  evaluation: string;
  updatedAt: string;
} {
  const evals = [
    r.longTermEvaluation ? `長期：${r.longTermEvaluation}` : '',
    r.shortTermEvaluation ? `短期：${r.shortTermEvaluation}` : '',
  ].filter(Boolean);
  const updated = (r.updatedAt || r.createdAt || '').slice(0, 10);
  return {
    period: periodLabel(r),
    evaluation: evals.length > 0 ? evals.join('／') : '評価未入力',
    updatedAt: updated ? updated.replace(/-/g, '/') : '',
  };
}
