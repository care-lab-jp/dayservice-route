/**
 * モニタリング記録の Excel(.xlsx) 出力。
 *
 * ★ブラウザ内だけでファイルを作る。外部サーバーへは一切送信しない。
 *   （SheetJS はクライアント側でワークブックを組み立てて保存するだけのライブラリ）
 * ★ライブラリは動的import で読み込むため、通常の画面表示では読み込まれない。
 *
 * シートの中身を組み立てる部分（buildMonitoringSheet）は純粋関数にしてあり、
 * ライブラリ無しでテストできる。
 */
import type { MonitoringRecord } from '../types';
import { displayMonitoringText, formatDateJa, periodLabel } from './monitoringText';
import { buildMonitoringText } from './monitoringText';

/** シートに並べる「項目名 / 内容」の2列 */
export type SheetRow = [string, string];

export interface MonitoringSheet {
  rows: SheetRow[];
  /** 列幅（文字数の目安） */
  colWidths: number[];
  fileName: string;
  sheetName: string;
}

/** ファイル名に使えない文字を除く（施設名は含めない） */
function safeFileNamePart(s: string): string {
  return (s ?? '').replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 40) || '利用者';
}

export function buildMonitoringSheet(
  record: MonitoringRecord,
  memberName: string
): MonitoringSheet {
  const blocks = buildMonitoringText(record).blocks;
  const text = displayMonitoringText(record);

  const rows: SheetRow[] = [
    ['モニタリング記録', ''],
    ['', ''],
    ['利用者氏名', memberName],
    ['モニタリング期間', periodLabel(record)],
    ['作成日', formatDateJa((record.updatedAt ?? record.createdAt ?? '').slice(0, 10))],
    ['', ''],
    ['【長期目標】', record.longTermGoal ?? ''],
    ['【長期目標の評価】', [record.longTermEvaluation ?? '', (record.longTermComment ?? '').trim()]
      .filter(Boolean).join('\n')],
    ['【短期目標】', record.shortTermGoal ?? ''],
    ['【短期目標の評価】', [record.shortTermEvaluation ?? '', (record.shortTermComment ?? '').trim()]
      .filter(Boolean).join('\n')],
    ['【現在の状態】', blocks.condition],
    ['【支援内容】', blocks.support],
    ['【本人の意向】', blocks.wish],
    ['【今後の支援方針】', blocks.policy],
    ['【モニタリング総合コメント】', (record.overallComment ?? '').trim()],
    ['', ''],
    ['【記録本文】', text],
  ];

  const datePart = (record.periodTo || record.updatedAt || record.createdAt || '').slice(0, 10);
  return {
    rows,
    colWidths: [22, 80],
    // 施設名は含めない
    fileName: `monitoring_${safeFileNamePart(memberName)}_${datePart}.xlsx`,
    sheetName: 'モニタリング記録',
  };
}

/** 出力前に必ず表示する確認文言 */
export const EXPORT_CONFIRM_MESSAGE =
  'このファイルには利用者の個人情報・支援情報が含まれます。\n' +
  '保存先や共有先を確認してください。\n\n出力しますか？';

/**
 * 確認を取ってから出力する。
 * 確認関数を差し替えられるようにして、確認なしで出力されないことをテストで固定している。
 * @returns 出力したファイル名。取りやめた場合は null
 */
export async function requestMonitoringExcelExport(
  record: MonitoringRecord,
  memberName: string,
  confirmFn: (message: string) => boolean = (m) => window.confirm(m),
  /** 実際の書き出し処理（テストで差し替えられるようにしている） */
  exporter: (r: MonitoringRecord, name: string) => Promise<string> = exportMonitoringExcel
): Promise<string | null> {
  if (!confirmFn(EXPORT_CONFIRM_MESSAGE)) return null;
  return exporter(record, memberName);
}

/**
 * Excelファイルを生成してダウンロードする。
 * 直接呼ばず、requestMonitoringExcelExport を使うこと（確認の取りこぼしを防ぐため）。
 */
export async function exportMonitoringExcel(
  record: MonitoringRecord,
  memberName: string
): Promise<string> {
  const sheet = buildMonitoringSheet(record, memberName);
  // 使うときだけ読み込む（初期表示を重くしない）
  const XLSX = await import('xlsx');

  const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
  ws['!cols'] = sheet.colWidths.map((w) => ({ wch: w }));
  // 見出し行を結合し、本文は折り返して表示する
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  sheet.rows.forEach((_, i) => {
    const addr = XLSX.utils.encode_cell({ r: i, c: 1 });
    if (ws[addr]) ws[addr].s = { alignment: { wrapText: true, vertical: 'top' } };
  });
  ws['!rows'] = sheet.rows.map(([label, value]) => {
    const lines = String(value ?? '').split('\n').length;
    const wrapped = Math.ceil(String(value ?? '').length / 60);
    return { hpt: label.startsWith('【') ? Math.max(24, (lines + wrapped) * 15) : 20 };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName);
  XLSX.writeFile(wb, sheet.fileName); // ブラウザ内でダウンロードされる
  return sheet.fileName;
}
