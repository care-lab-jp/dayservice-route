/**
 * 提出様式「モニタリング報告」の中身を組み立てる（純粋関数・外部通信なし）。
 *
 * 紙の様式に合わせた4列の表を作る。
 *   目標 ／ 実施状況 ／ 目標の達成度・満足度 ／ 今後の方向性
 *
 * ★選択されていない項目は □ のまま出力する（アプリが勝手に選ばない）
 * ★日付・氏名・事業所名は入力されたものだけを使う
 */
import type {
  MonitoringGoalAssessment, MonitoringRecord,
} from '../types';
import { formatDateJa } from './monitoringText';

export const IMPLEMENTATION_OPTIONS = ['計画通り実施できた', '一部実施できた', '未実施'] as const;
export const ACHIEVEMENT_OPTIONS = ['達成', '一部達成', '未達成'] as const;
export const SATISFACTION_OPTIONS = ['満足', 'ある程度満足', '不満'] as const;
export const DIRECTION_OPTIONS = [
  'サービスを継続', 'サービス内容変更して継続', 'サービスを中止',
] as const;

/** 選択済みなら ☑、未選択なら □ */
export function checkbox(label: string, selected: boolean): string {
  return `${selected ? '☑' : '□'} ${label}`;
}

function checkboxList(options: readonly string[], selected?: string): string {
  return options.map((o) => checkbox(o, o === selected)).join('\n');
}

/** 日付が未入力なら紙の様式と同じ空欄表記にする */
function periodText(a?: MonitoringGoalAssessment): string {
  const f = formatDateJa(a?.periodFrom ?? '');
  const t = formatDateJa(a?.periodTo ?? '');
  if (f || t) return `期間：${f || '　年　月　日'} ～ ${t || '　年　月　日'}`;
  return '期間：　年　月　日 ～ 　年　月　日';
}

/**
 * 既存の評価（6択）から達成度を引き継ぐ。
 * 同じ言葉のときだけ引き継ぎ、「概ね達成」などは勝手に読み替えない。
 */
export function inheritAchievement(
  assessment?: MonitoringGoalAssessment,
  legacyEvaluation?: string
): string | undefined {
  if (assessment?.achievement) return assessment.achievement;
  return (ACHIEVEMENT_OPTIONS as readonly string[]).includes(legacyEvaluation ?? '')
    ? legacyEvaluation
    : undefined;
}

export interface ReportGoalRow {
  /** 「長期目標」または「短期目標」 */
  title: string;
  /** 1列目：期間＋目標名＋目標本文 */
  goalCell: string;
  /** 2列目：実施状況＋具体的な理由等 */
  implementationCell: string;
  /** 3列目：目標達成度＋本人満足度 */
  achievementCell: string;
  /** 4列目：今後の方向性 */
  directionCell: string;
}

export interface MonitoringReport {
  title: string;
  /** ご利用者氏名／実施日／実施者 */
  headerLeft: string;
  headerRight: string[];
  columnTitles: string[];
  rows: ReportGoalRow[];
  footer: string;
  colWidths: number[];
  fileName: string;
  sheetName: string;
}

function goalRow(
  title: string,
  goalText: string,
  assessment: MonitoringGoalAssessment | undefined,
  legacyComment: string | undefined,
  legacyEvaluation: string | undefined
): ReportGoalRow {
  // 「具体的な理由等」は、専用欄が未入力なら従来の評価コメントを使う（職員が書いた文をそのまま）
  const reason = (assessment?.reason ?? '').trim() || (legacyComment ?? '').trim();
  const achievement = inheritAchievement(assessment, legacyEvaluation);

  return {
    title,
    goalCell: [periodText(assessment), '', title, (goalText ?? '').trim()]
      .filter((v, i) => i < 3 || v)
      .join('\n'),
    implementationCell: [
      '実施状況',
      checkboxList(IMPLEMENTATION_OPTIONS, assessment?.implementation),
      '',
      '具体的な理由等',
      reason,
    ].join('\n').trimEnd(),
    achievementCell: [
      '目標達成度',
      checkboxList(ACHIEVEMENT_OPTIONS, achievement),
      '',
      '本人満足度',
      checkboxList(SATISFACTION_OPTIONS, assessment?.satisfaction),
    ].join('\n'),
    directionCell: [
      '今後の方向性',
      checkboxList(DIRECTION_OPTIONS, assessment?.direction),
    ].join('\n'),
  };
}

/** ファイル名に使えない文字を除く（施設名は含めない） */
function safeFileNamePart(s: string): string {
  return (s ?? '').replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 40) || '利用者';
}

export function buildMonitoringReport(
  record: MonitoringRecord,
  memberName: string,
  officeName = ''
): MonitoringReport {
  const dateText = record.monitoringDate
    ? formatDateJa(record.monitoringDate)
    : '　　年　　月　　日';

  const datePart =
    (record.monitoringDate || record.periodTo || record.updatedAt || record.createdAt || '')
      .slice(0, 10);

  return {
    title: 'モニタリング報告',
    headerLeft: `ご利用者氏名：　${memberName}　様`,
    headerRight: [
      `モニタリング実施日：${dateText}`,
      `モニタリング実施者：${(record.monitorName ?? '').trim()}`,
    ],
    columnTitles: ['目標', '実施状況', '目標の達成度・満足度', '今後の方向性'],
    rows: [
      goalRow('長期目標', record.longTermGoal, record.longTermAssessment,
        record.longTermComment, record.longTermEvaluation),
      goalRow('短期目標', record.shortTermGoal, record.shortTermAssessment,
        record.shortTermComment, record.shortTermEvaluation),
    ],
    footer: `事業所名：　${(officeName ?? '').trim()}`,
    colWidths: [34, 30, 26, 30],
    fileName: `monitoring_${safeFileNamePart(memberName)}_${datePart}.xlsx`,
    sheetName: 'モニタリング報告',
  };
}
