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
import { buildMonitoringReport } from './monitoringReport';

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
 * 確認関数と出力処理を差し替えられるようにして、
 * 確認なしで出力されないことをテストで固定している。
 * @returns 出力したファイル名。取りやめた場合は null
 */
export async function requestMonitoringExcelExport(
  record: MonitoringRecord,
  memberName: string,
  confirmFn: (message: string) => boolean = (m) => window.confirm(m),
  exporter: (r: MonitoringRecord, name: string, office?: string) => Promise<string> =
    exportMonitoringExcel,
  officeName = ''
): Promise<string | null> {
  if (!confirmFn(EXPORT_CONFIRM_MESSAGE)) return null;
  return exporter(record, memberName, officeName);
}

/* ---------------- ここから下がファイル生成（ブラウザ内で完結） ---------------- */

const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BORDER_ALL = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/**
 * 提出様式「モニタリング報告」の Excel を作ってダウンロードする。
 * ・ExcelJS を動的importで読み込む（通常の画面表示では読み込まれない）
 * ・外部サーバーへは一切送信しない
 */
export async function exportMonitoringExcel(
  record: MonitoringRecord,
  memberName: string,
  officeName = ''
): Promise<string> {
  const report = buildMonitoringReport(record, memberName, officeName);
  const detail = buildMonitoringSheet(record, memberName);

  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'dayservice-route';
  wb.created = new Date();

  /* ---- 1枚目：提出様式 ---- */
  const ws = wb.addWorksheet(report.sheetName, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = report.colWidths.map((w) => ({ width: w }));

  // 表題
  ws.mergeCells('A1:D1');
  const title = ws.getCell('A1');
  title.value = report.title;
  title.font = { size: 16, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // 氏名・実施日・実施者
  ws.mergeCells('A2:B2');
  ws.getCell('A2').value = report.headerLeft;
  ws.getCell('C2').value = report.headerRight[0];
  ws.getCell('D2').value = report.headerRight[1];
  [ws.getCell('A2'), ws.getCell('C2'), ws.getCell('D2')].forEach((c) => {
    c.font = { size: 11 };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 6;

  // 表の見出し
  const headerRow = ws.getRow(4);
  report.columnTitles.forEach((t, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = t;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER_ALL;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  });
  headerRow.height = 24;

  // 長期目標・短期目標
  report.rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    [r.goalCell, r.implementationCell, r.achievementCell, r.directionCell].forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = BORDER_ALL;
    });
    row.height = 170;
  });

  // 事業所名
  const footerRowIndex = 5 + report.rows.length + 1;
  ws.mergeCells(`A${footerRowIndex}:D${footerRowIndex}`);
  const footer = ws.getCell(`A${footerRowIndex}`);
  footer.value = report.footer;
  footer.alignment = { vertical: 'middle' };
  ws.getRow(footerRowIndex).height = 24;

  /* ---- 2枚目：記録内容（項目名と内容の一覧） ---- */
  const ws2 = wb.addWorksheet('記録内容');
  ws2.columns = detail.colWidths.map((w) => ({ width: w }));
  detail.rows.forEach((r, i) => {
    const row = ws2.getRow(i + 1);
    row.getCell(1).value = r[0];
    row.getCell(2).value = r[1];
    row.getCell(1).font = { bold: r[0].startsWith('【') || i === 0 };
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };
    if (r[0]) row.height = r[0].startsWith('【') ? 48 : 20;
  });

  /* ---- ダウンロード ---- */
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = report.fileName;
  a.click();
  URL.revokeObjectURL(url);

  return report.fileName;
}
