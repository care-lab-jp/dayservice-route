/**
 * 支援記録の文章づくり（完全ローカル・定型文の組み立てのみ）。
 *
 * ★この機能は外部通信を一切行わない。
 *   生成AI・外部API・ログ送信のいずれも使わず、入力から定型文を組み立てるだけ。
 *
 * ★入力されていない事実は作らない。
 *   期間・程度・数値・断定表現はテンプレートに存在しない。
 *   文章に数値が出るのは、職員が「開始時」と「現在」の両方を入力した場合だけ。
 *
 * 副作用のない純粋関数として実装し、テストで振る舞いを固定している。
 */
import type { SupportMeasures, SupportRecord } from '../types';
import { findItem, type SupportItem } from './supportCatalog';

export interface SupportTextBlocks {
  /** ① 現在の状態 */
  condition: string;
  /** ② 支援内容 */
  support: string;
  /** ③ 本人の希望 */
  wish: string;
  /** ④ 今後 */
  plan: string;
  /** 補足メモ（職員が書いた文をそのまま載せる） */
  note: string;
}

export interface SupportTextResult {
  text: string;
  blocks: SupportTextBlocks;
}

/** 名詞句を「、」でつなぐ */
function joinNouns(items: SupportItem[]): string {
  return items.map((i) => i.noun).join('、');
}

/** 開始時と現在の両方が入っている項目だけを比較文にする */
function comparisonSentences(baseline?: SupportMeasures, current?: SupportMeasures): string[] {
  const out: string[] = [];
  if (!baseline || !current) return out;

  const pairs: { key: keyof SupportMeasures; label: string }[] = [
    { key: 'gait', label: '歩行状態' },
    { key: 'standUp', label: '立ち上がり' },
    { key: 'assistance', label: '介助量' },
  ];
  for (const { key, label } of pairs) {
    const b = baseline[key];
    const c = current[key];
    if (typeof b === 'string' && typeof c === 'string' && b && c && b !== c) {
      out.push(`${label}は「${b}」から「${c}」に変化しています。`);
    }
  }

  const b = baseline.walkDistanceM;
  const c = current.walkDistanceM;
  if (typeof b === 'number' && typeof c === 'number' && Number.isFinite(b) && Number.isFinite(c)) {
    if (c > b) out.push(`歩行距離は${b}mから${c}mに延長しています。`);
    else if (c < b) out.push(`歩行距離は${b}mから${c}mに短縮しています。`);
    else out.push(`歩行距離は${b}mで変わっていません。`);
  }
  return out;
}

/** 比較データが1つでもあるか（「利用開始時と比較して」を付けてよいかの判定） */
function hasComparison(baseline?: SupportMeasures, current?: SupportMeasures): boolean {
  return comparisonSentences(baseline, current).length > 0;
}

export function buildSupportText(
  record: Pick<SupportRecord, 'checkedItems' | 'baseline' | 'current'> & { note?: string }
): SupportTextResult {
  const items = (record.checkedItems ?? [])
    .map(findItem)
    .filter((i): i is SupportItem => !!i);

  const improved = items.filter((i) => i.kind === 'improve');
  const neutral = items.filter((i) => i.kind === 'neutral');
  const declined = items.filter((i) => i.kind === 'decline');
  const supports = items.filter((i) => i.category === 'support');
  const wishes = items.filter((i) => i.category === 'wish');

  const comparisons = comparisonSentences(record.baseline, record.current);
  const withComparison = hasComparison(record.baseline, record.current);

  /* ---- ① 現在の状態 ---- */
  const conditionParts: string[] = [];
  if (improved.length > 0) {
    const prefix = withComparison ? '利用開始時と比較して、' : '現在、';
    conditionParts.push(`${prefix}${joinNouns(improved)}がみられています。`);
  }
  if (declined.length > 0) {
    conditionParts.push(`${joinNouns(declined)}がみられています。`);
  }
  if (neutral.length > 0 && improved.length === 0 && declined.length === 0) {
    conditionParts.push('現在の状態を維持しています。');
  }
  // 数値・選択の比較は、チェック項目の有無にかかわらず事実として載せる
  conditionParts.push(...comparisons);
  const condition = conditionParts.join('');

  /* ---- ② 支援内容 ---- */
  const support = supports.length > 0 ? `${joinNouns(supports)}に取り組んでいます。` : '';

  /* ---- ③ 本人の希望 ---- */
  const wish = wishes.length > 0 ? `本人は、${joinNouns(wishes)}を希望しています。` : '';

  /* ---- ④ 今後 ---- */
  let plan: string;
  if (declined.length > 0) {
    plan = '今後は、状態の変化に留意しながら、必要な支援を継続します。';
  } else if (improved.length > 0) {
    plan = '今後も現在の身体機能の維持・向上を目指し、支援を継続します。';
  } else {
    plan = '今後も現在の状態の維持を目指し、支援を継続します。';
  }

  /* ---- 補足メモ（職員の記述をそのまま） ---- */
  const noteText = (record.note ?? '').trim();
  const note = noteText ? `補足：${noteText}` : '';

  const blocks: SupportTextBlocks = { condition, support, wish, plan, note };
  const text = [condition, support, wish, plan, note].filter(Boolean).join('\n');

  return { text, blocks };
}

/** 保存されている文章（編集済みがあればそちら）を取り出す */
export function displayTextOf(r: SupportRecord): string {
  return (r.editedText ?? '').trim() || r.generatedText;
}
