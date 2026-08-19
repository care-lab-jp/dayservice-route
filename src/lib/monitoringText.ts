/**
 * モニタリング記録の文章づくり（完全ローカル・定型文の組み立てのみ）。
 *
 * ★外部通信を一切行わない（生成AI・外部API・ログ送信のいずれも使わない）
 * ★入力されていない事実は作らない
 *   ・期間は職員が入力した日付だけを使う（「3か月」等は生成しない）
 *   ・目標は職員が入力した文字列をそのまま使う（推測して補完しない）
 *   ・評価は職員が選んだ選択肢だけを使う（アプリが達成／未達成を判定しない）
 *   ・「評価困難」を選んだ場合は、達成・改善を示す文を出さない
 *   ・数値は開始時と現在の両方が入力されている場合のみ使う
 *
 * supportText.ts と同じく副作用のない純粋関数として実装している。
 */
import type { GoalEvaluation, MonitoringRecord } from '../types';
import { buildSupportText } from './supportText';
import { findItem, type SupportItem } from './supportCatalog';

export interface MonitoringTextBlocks {
  /** ① モニタリング期間 */
  period: string;
  /** ② 長期目標 */
  longTermGoal: string;
  /** ③ 短期目標 */
  shortTermGoal: string;
  /** ④ 現在の状態 */
  condition: string;
  /** ⑤ 支援内容 */
  support: string;
  /** ⑥ 本人の意向 */
  wish: string;
  /** ⑦ 目標に対する評価 */
  evaluation: string;
  /** ⑧ 今後の支援方針 */
  policy: string;
}

export interface MonitoringTextResult {
  text: string;
  blocks: MonitoringTextBlocks;
}

export type MonitoringInput = Pick<
  MonitoringRecord,
  | 'periodFrom' | 'periodTo' | 'longTermGoal' | 'shortTermGoal'
  | 'longTermEvaluation' | 'shortTermEvaluation'
  | 'longTermComment' | 'shortTermComment'
  | 'checkedItems' | 'baseline' | 'current' | 'policy'
>;

/** "2026-07-01" → "2026年7月1日"。解釈できない値はそのまま返す */
export function formatDateJa(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  if (!m) return (iso ?? '').trim();
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 評価が「前向きな結果」を示すものか。文章の締め方を変えるために使う */
function isPositive(e?: GoalEvaluation): boolean {
  return e === '達成' || e === '概ね達成';
}

/** 評価が入力されていない、または判断できないものか */
function isUnknown(e?: GoalEvaluation): boolean {
  return !e || e === '評価困難';
}

export function buildMonitoringText(input: MonitoringInput): MonitoringTextResult {
  const items = (input.checkedItems ?? [])
    .map(findItem)
    .filter((i): i is SupportItem => !!i);
  const hasDecline = items.some((i) => i.kind === 'decline');
  const hasImprove = items.some((i) => i.kind === 'improve');

  // 現在の状態・支援内容・本人の意向は、支援記録と同じ組み立てを再利用する
  const support = buildSupportText({
    checkedItems: input.checkedItems ?? [],
    baseline: input.baseline,
    current: input.current,
  });

  /* ---- ① 期間（入力された日付のみ。日数・月数は計算しない） ---- */
  const from = formatDateJa(input.periodFrom ?? '');
  const to = formatDateJa(input.periodTo ?? '');
  let period = '';
  if (from && to) period = `モニタリング期間：${from}から${to}まで`;
  else if (from) period = `モニタリング期間：${from}から`;
  else if (to) period = `モニタリング期間：${to}まで`;

  /* ---- ②③ 目標（入力された文字列をそのまま） ---- */
  const lt = (input.longTermGoal ?? '').trim();
  const st = (input.shortTermGoal ?? '').trim();
  const longTermGoal = lt ? `長期目標：${lt}` : '';
  const shortTermGoal = st ? `短期目標：${st}` : '';

  /* ---- ④⑤⑥ 支援記録から ---- */
  const condition = support.blocks.condition;
  const supportText = support.blocks.support;
  const wish = support.blocks.wish;

  /* ---- ⑦ 目標に対する評価（選ばれた選択肢のみ） ---- */
  const evalParts: string[] = [];
  if (input.longTermEvaluation) {
    evalParts.push(`長期目標に対する評価：${input.longTermEvaluation}`);
  }
  const ltc = (input.longTermComment ?? '').trim();
  if (ltc) evalParts.push(ltc);
  if (input.shortTermEvaluation) {
    evalParts.push(`短期目標に対する評価：${input.shortTermEvaluation}`);
  }
  const stc = (input.shortTermComment ?? '').trim();
  if (stc) evalParts.push(stc);
  const evaluation = evalParts.join('\n');

  /* ---- ⑧ 今後の支援方針 ---- */
  let policy = (input.policy ?? '').trim();
  if (!policy) {
    // 職員が方針を書いていない場合のみ、入力内容から矛盾しない範囲で定型文を置く
    if (hasDecline) {
      policy = '今後は、状態の変化に留意しながら、必要な支援を継続します。';
    } else if (isUnknown(input.longTermEvaluation) && isUnknown(input.shortTermEvaluation)) {
      // 評価が未入力または評価困難のときは、達成・改善を示す表現を使わない
      policy = '今後も、状況を確認しながら支援を継続します。';
    } else if (isPositive(input.shortTermEvaluation) || isPositive(input.longTermEvaluation)) {
      policy = '今後も現在の目標に沿って、支援を継続します。';
    } else if (hasImprove) {
      policy = '今後も現在の身体機能の維持・向上を目指し、支援を継続します。';
    } else {
      policy = '今後も現在の状態の維持を目指し、支援を継続します。';
    }
  }

  const blocks: MonitoringTextBlocks = {
    period, longTermGoal, shortTermGoal,
    condition, support: supportText, wish, evaluation, policy,
  };

  const text = [
    period, longTermGoal, shortTermGoal,
    condition, supportText, wish, evaluation, policy,
  ].filter(Boolean).join('\n');

  return { text, blocks };
}

/** 保存済みの文章（編集済みがあればそちら） */
export function displayMonitoringText(r: MonitoringRecord): string {
  return (r.editedText ?? '').trim() || r.generatedText;
}

/** 期間の表示（一覧用） */
export function periodLabel(r: Pick<MonitoringRecord, 'periodFrom' | 'periodTo'>): string {
  const f = formatDateJa(r.periodFrom ?? '');
  const t = formatDateJa(r.periodTo ?? '');
  if (f && t) return `${f} 〜 ${t}`;
  return f || t || '期間未入力';
}
