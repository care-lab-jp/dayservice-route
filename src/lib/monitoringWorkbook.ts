/**
 * 月次モニタリングのExcel出力。
 * 添付の「モニタリング報告（通所）原本.xlsx」を解析し、その様式を再現している。
 *
 * 【原本から読み取った仕様】
 *  シート名   : 「西暦,月」（例 2024,7）。月ごとに1シート
 *  用紙       : A4横（paperSize 9）、余白 左右0.197/上0.984/下0.787インチ
 *  既定       : 行高 19.0、列幅 9.0、フォント ＭＳ Ｐゴシック
 *  範囲       : A1:P27
 *  A1:P1      : 「モニタリング報告」22pt 中央
 *  K2:P2      : モニタリング実施日（下線）
 *  A3:E3 / F3 : ご利用者氏名 ／「様」（下線）
 *  K3:P3      : モニタリング実施者（下線）
 *  5行目      : 目標 / 実施状況 / 目標の達成度・満足度 / 今後の方向性（19.5pt高）
 *  6〜15行    : 長期目標のブロック（外枠 medium）
 *  16〜25行   : 短期目標のブロック（外枠 medium）
 *  K27:P27    : 事業所名（下線）
 *  チェック   : ☐（U+2610）／☑（U+2611）
 *
 * ★外部通信は行わない。ExcelJSは動的importで読み込み、ブラウザ内でファイルを作る。
 */
import type {
  MonitoringGoalAssessment, MonitoringMonthlyRecord,
} from '../types';
import {
  ACHIEVEMENT_OPTIONS, DIRECTION_OPTIONS, IMPLEMENTATION_OPTIONS, SATISFACTION_OPTIONS,
} from './monitoringOptions';
import { parseDate, sheetNameOf } from './monitoringYear';

/* ---------------- 原本の文言（空欄時はこの表記のまま） ---------------- */

export const BLANK_DATE = '　     年    月    日';
export const TITLE = 'モニタリング報告';

/** 原本と同じ ☐ / ☑ を使う */
export const checkLine = (label: string, on: boolean) => `${on ? '☑' : '☐'}${label}`;

/** "2026-07-10" → "　2026年7月10日"。未入力なら原本の空欄表記 */
export function dateOrBlank(iso?: string): string {
  const p = parseDate(iso ?? '');
  if (!p) return BLANK_DATE;
  return `　${p.y}年${p.m}月${p.d}日`;
}

/* ---------------- シートの中身（純粋なデータ） ---------------- */

export interface GoalBlockModel {
  label: '長期目標' | '短期目標';
  periodFrom: string;
  periodTo: string;
  goalText: string;
  implementation: string[];
  reasonText: string;
  achievement: string[];
  satisfaction: string[];
  direction: string[];
}

export interface MonthSheetModel {
  sheetName: string;
  year: number;
  month: number;
  title: string;
  implementedText: string;
  memberNameText: string;
  monitorText: string;
  officeText: string;
  long: GoalBlockModel;
  short: GoalBlockModel;
}

function block(
  label: '長期目標' | '短期目標',
  a: MonitoringGoalAssessment | undefined,
  goalText: string
): GoalBlockModel {
  const v = a ?? {};
  return {
    label,
    periodFrom: `${dateOrBlank(v.periodFrom)}～`,
    periodTo: dateOrBlank(v.periodTo),
    goalText: (goalText ?? '').trim(),
    implementation: IMPLEMENTATION_OPTIONS.map((o) => checkLine(o, o === v.implementation)),
    reasonText: (v.reason ?? '').trim(),
    achievement: ACHIEVEMENT_OPTIONS.map((o) => checkLine(o, o === v.achievement)),
    satisfaction: SATISFACTION_OPTIONS.map((o) => checkLine(o, o === v.satisfaction)),
    direction: DIRECTION_OPTIONS.map((o) => checkLine(o, o === v.direction)),
  };
}

export function buildMonthSheetModel(
  record: MonitoringMonthlyRecord | null,
  ctx: { year: number; month: number; memberName: string; officeName?: string }
): MonthSheetModel {
  return {
    sheetName: sheetNameOf(ctx.year, ctx.month),
    year: ctx.year,
    month: ctx.month,
    title: TITLE,
    implementedText: `モニタリング実施日　：${dateOrBlank(record?.implementedOn)}`,
    memberNameText: `ご利用者氏名　：　${ctx.memberName}`,
    monitorText: `モニタリング実施者　：　${(record?.monitorName ?? '').trim()}`,
    officeText: `事業所名　：　${(ctx.officeName ?? '').trim()}`,
    long: block('長期目標', record?.longTerm, record?.longGoalText ?? ''),
    short: block('短期目標', record?.shortTerm, record?.shortGoalText ?? ''),
  };
}

/** ファイル名（施設名は含めない） */
export function monitoringFileName(memberName: string, year: number): string {
  const safe = (memberName ?? '').replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 40) || '利用者';
  return `monitoring_${safe}_${year}.xlsx`;
}

/* ---------------- Excelの書き出し ---------------- */

const FONT = 'ＭＳ Ｐゴシック';
const F16 = { name: FONT, size: 16 };
const F22 = { name: FONT, size: 22 };
const THIN = { style: 'thin' as const };
const MED = { style: 'medium' as const };

/** 原本の列幅（未指定は既定9.0） */
const COL_WIDTHS: Record<string, number> = { A: 9, H: 9, I: 9, L: 9, M: 9, P: 12.09 };

export interface MonitoringExcelInput {
  memberName: string;
  officeName?: string;
  year: number;
  /** 月(1-12) -> その月の記録。無い月は空欄の様式を出す */
  records: Map<number, MonitoringMonthlyRecord | null>;
  /** 出力する月。未指定なら1〜12月すべて */
  months?: number[];
}

export async function buildMonitoringYearWorkbook(input: MonitoringExcelInput) {
  const mod: any = await import('exceljs');
  const ExcelJS: any = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'dayservice-route';
  wb.created = new Date();

  const months = input.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  for (const month of months) {
    const model = buildMonthSheetModel(input.records.get(month) ?? null, {
      year: input.year, month, memberName: input.memberName, officeName: input.officeName,
    });
    writeMonthSheet(wb, model);
  }

  return { wb, fileName: monitoringFileName(input.memberName, input.year) };
}

function writeMonthSheet(wb: any, m: MonthSheetModel) {
  const ws = wb.addWorksheet(m.sheetName, {
    properties: { defaultRowHeight: 19, defaultColWidth: 9 },
    pageSetup: {
      paperSize: 9, orientation: 'landscape',
      margins: { left: 0.197, right: 0.197, top: 0.984, bottom: 0.787, header: 0.3, footer: 0.3 },
      printArea: 'A1:P27',
    },
  });

  // 列幅
  ws.columns = 'ABCDEFGHIJKLMNOP'.split('').map((c) => ({ width: COL_WIDTHS[c] ?? 9 }));

  const set = (addr: string, value: string, opts: any = {}) => {
    const cell = ws.getCell(addr);
    cell.value = value;
    cell.font = opts.font ?? F16;
    cell.alignment = opts.alignment ?? { vertical: 'middle' };
    if (opts.border) cell.border = opts.border;
    return cell;
  };
  /** 範囲の各セルに罫線を足す（結合セルでも枠が消えないように） */
  const edge = (r1: number, c1: number, r2: number, c2: number, sides: any) => {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const cell = ws.getRow(r).getCell(c);
        const b = { ...(cell.border ?? {}) };
        if (sides.top && r === r1) b.top = MED;
        if (sides.bottom && r === r2) b.bottom = MED;
        if (sides.left && c === c1) b.left = MED;
        if (sides.right && c === c2) b.right = MED;
        cell.border = b;
      }
    }
  };
  const underline = (r: number, c1: number, c2: number) => {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.border = { ...(cell.border ?? {}), bottom: THIN };
    }
  };

  /* ---- 見出し ---- */
  ws.mergeCells('A1:P1');
  set('A1', m.title, { font: F22, alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.getRow(1).height = 25.5;

  ws.mergeCells('K2:P2');
  set('K2', m.implementedText);
  underline(2, 11, 16);

  ws.mergeCells('A3:E3');
  set('A3', m.memberNameText);
  set('F3', '様');
  underline(3, 1, 6);

  ws.mergeCells('K3:P3');
  set('K3', m.monitorText);
  underline(3, 11, 16);

  /* ---- 列見出し（5行目） ---- */
  ws.mergeCells('A5:D5');
  set('A5', '目標', { alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.mergeCells('E5:H5');
  set('E5', '実施状況', { alignment: { horizontal: 'center', vertical: 'middle' } });
  edge(5, 5, 5, 8, { bottom: true });
  ws.mergeCells('I5:L5');
  set('I5', '目標の達成度・満足度', { alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.mergeCells('M5:P5');
  set('M5', '今後の方向性', { alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.getRow(5).height = 19.5;

  /* ---- 目標ブロック（長期＝6〜15行、短期＝16〜25行） ---- */
  const writeBlock = (top: number, b: GoalBlockModel) => {
    const goalTop = top + 4;      // 長期なら10、短期なら20
    const bottom = top + 9;       // 長期なら15、短期なら25

    // 1列目：目標名・期間・本文
    ws.mergeCells(`A${top}:D${top}`);
    set(`A${top}`, b.label, { alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.mergeCells(`A${top + 1}:A${top + 2}`);
    set(`A${top + 1}`, '期間　：　');
    ws.mergeCells(`B${top + 1}:D${top + 1}`);
    set(`B${top + 1}`, b.periodFrom);
    ws.mergeCells(`B${top + 2}:D${top + 2}`);
    set(`B${top + 2}`, b.periodTo, { alignment: { horizontal: 'right', vertical: 'middle' } });
    ws.mergeCells(`A${goalTop}:D${bottom}`);
    set(`A${goalTop}`, b.goalText, {
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
    });

    // 2列目：実施状況・具体的な理由等
    b.implementation.forEach((line, i) => set(`E${top + i}`, line));
    ws.mergeCells(`E${goalTop}:H${goalTop}`);
    set(`E${goalTop}`, '具体的な理由等', {
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    ws.mergeCells(`E${goalTop + 1}:H${bottom}`);
    set(`E${goalTop + 1}`, b.reasonText, {
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
    });

    // 3列目：目標達成度・本人満足度
    ws.mergeCells(`I${top}:L${top}`);
    set(`I${top}`, '目標達成度', { alignment: { horizontal: 'center', vertical: 'middle' } });
    b.achievement.forEach((line, i) => set(`I${top + 1 + i}`, line));
    ws.mergeCells(`I${goalTop + 1}:L${goalTop + 1}`);
    set(`I${goalTop + 1}`, '本人満足度', { alignment: { horizontal: 'center', vertical: 'middle' } });
    b.satisfaction.forEach((line, i) => set(`I${goalTop + 2 + i}`, line));

    // 4列目：今後の方向性
    b.direction.forEach((line, i) => set(`M${top + i}`, line));

    // 外枠（4つの列グループそれぞれを medium で囲む）
    edge(top, 1, bottom, 4, { top: true, bottom: true, left: true, right: true });
    edge(top, 5, bottom, 8, { top: true, bottom: true, left: true, right: true });
    edge(top, 9, bottom, 12, { top: true, bottom: true, left: true, right: true });
    edge(top, 13, bottom, 16, { top: true, bottom: true, left: true, right: true });
    ws.getRow(bottom).height = 19.5;
  };

  writeBlock(6, m.long);
  writeBlock(16, m.short);

  /* ---- 事業所名 ---- */
  ws.mergeCells('K27:P27');
  set('K27', m.officeText);
  underline(27, 11, 16);
}
