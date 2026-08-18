/**
 * 支援記録のチェック項目カタログ。
 *
 * 【設計上の約束】
 * ここに書く定型文には、次を絶対に含めない。
 *   ・数値（10m、3回 など）
 *   ・期間（3か月、半年 など）
 *   ・程度（大幅に、著しく、かなり など）
 *   ・断定（自立した、治った、完治 など）
 *   ・評価者の推測（〜と思われる など）
 * 数値が文章に出てよいのは、職員が実際に入力した測定値だけ。
 * この約束は supportText.test.ts の禁止語テストで機械的に検査している。
 */

export type SupportCategory = 'physical' | 'adl' | 'support' | 'wish';

/** 変化の向き。文章の組み立て方を切り替えるために使う */
export type ChangeKind = 'improve' | 'neutral' | 'decline';

export interface SupportItem {
  id: string;
  category: SupportCategory;
  /** 画面に出すチェック項目の文言 */
  label: string;
  /** 文中でつなぐときの名詞句（例「歩行距離の延長」） */
  noun: string;
  kind?: ChangeKind;
}

export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  physical: '身体機能の変化',
  adl: '生活動作（ADL）',
  support: '支援内容',
  wish: '本人の希望',
};

export const SUPPORT_ITEMS: SupportItem[] = [
  // ---- 身体機能の変化 ----
  { id: 'walk-distance', category: 'physical', label: '歩行距離が伸びた', noun: '歩行距離の延長', kind: 'improve' },
  { id: 'stand-up', category: 'physical', label: '立ち上がりが安定した', noun: '立ち上がり動作の安定', kind: 'improve' },
  { id: 'gait-stable', category: 'physical', label: '歩行が安定した', noun: '歩行の安定', kind: 'improve' },
  { id: 'gait-speed', category: 'physical', label: '歩行速度が向上した', noun: '歩行速度の向上', kind: 'improve' },
  { id: 'balance', category: 'physical', label: 'バランスが安定した', noun: 'バランスの安定', kind: 'improve' },
  { id: 'assist-less', category: 'physical', label: '介助量が減った', noun: '介助量の軽減', kind: 'improve' },
  { id: 'less-tired', category: 'physical', label: '疲れにくくなった', noun: '疲労感の軽減', kind: 'improve' },
  { id: 'stamina', category: 'physical', label: '体力が向上した', noun: '体力の向上', kind: 'improve' },
  { id: 'no-change', category: 'physical', label: '大きな変化はない', noun: '現在の状態の維持', kind: 'neutral' },
  { id: 'decline', category: 'physical', label: '状態が低下した', noun: '状態の低下', kind: 'decline' },

  // ---- 生活動作（ADL）----
  { id: 'adl-toilet', category: 'adl', label: 'トイレ動作が安定した', noun: 'トイレ動作の安定', kind: 'improve' },
  { id: 'adl-dressing', category: 'adl', label: '更衣動作が安定した', noun: '更衣動作の安定', kind: 'improve' },
  { id: 'adl-bathing', category: 'adl', label: '入浴動作が安定した', noun: '入浴動作の安定', kind: 'improve' },
  { id: 'adl-eating', category: 'adl', label: '食事動作が安定した', noun: '食事動作の安定', kind: 'improve' },
  { id: 'adl-transfer', category: 'adl', label: '移乗動作が安定した', noun: '移乗動作の安定', kind: 'improve' },
  { id: 'adl-indoor', category: 'adl', label: '屋内移動が安定した', noun: '屋内移動の安定', kind: 'improve' },
  { id: 'adl-assist', category: 'adl', label: '日常生活動作の介助量が減った', noun: '日常生活動作における介助量の軽減', kind: 'improve' },

  // ---- 支援内容 ----
  { id: 'sup-lower', category: 'support', label: '下肢筋力訓練', noun: '下肢筋力訓練' },
  { id: 'sup-upper', category: 'support', label: '上肢筋力訓練', noun: '上肢筋力訓練' },
  { id: 'sup-gait', category: 'support', label: '歩行訓練', noun: '歩行訓練' },
  { id: 'sup-balance', category: 'support', label: 'バランス訓練', noun: 'バランス訓練' },
  { id: 'sup-standup', category: 'support', label: '立ち上がり訓練', noun: '立ち上がり訓練' },
  { id: 'sup-transfer', category: 'support', label: '移乗訓練', noun: '移乗訓練' },
  { id: 'sup-adl', category: 'support', label: 'ADL訓練', noun: 'ADL訓練' },
  { id: 'sup-stretch', category: 'support', label: 'ストレッチ', noun: 'ストレッチ' },
  { id: 'sup-individual', category: 'support', label: '個別機能訓練', noun: '個別機能訓練' },

  // ---- 本人の希望 ----
  { id: 'wish-walk', category: 'wish', label: '自分で歩きたい', noun: '自分で歩くこと' },
  { id: 'wish-toilet', category: 'wish', label: 'トイレまで自分で行きたい', noun: '自分でトイレまで行くこと' },
  { id: 'wish-nofall', category: 'wish', label: '転倒せずに生活したい', noun: '転倒せずに生活すること' },
  { id: 'wish-outing', category: 'wish', label: '外出できるようになりたい', noun: '外出できるようになること' },
  { id: 'wish-home', category: 'wish', label: '自宅でできることを増やしたい', noun: '自宅でできることを増やすこと' },
  { id: 'wish-maintain', category: 'wish', label: '今の状態を維持したい', noun: '今の状態を維持すること' },
  { id: 'wish-lesstired', category: 'wish', label: '疲れにくくなりたい', noun: '疲れにくくなること' },
];

export const itemsOf = (c: SupportCategory) => SUPPORT_ITEMS.filter((i) => i.category === c);
export const findItem = (id: string) => SUPPORT_ITEMS.find((i) => i.id === id);

/* ---------------- 比較入力（選択式） ---------------- */

/** 未入力を表す値。空文字を「未選択」として扱う */
export const NOT_ENTERED = '';

export const GAIT_OPTIONS = ['自立', '見守り', '杖使用', '歩行器使用', '一部介助', '全介助', '車いす'] as const;
export const STANDUP_OPTIONS = ['自立', '見守り', '手すり使用', '一部介助', '全介助'] as const;
export const ASSISTANCE_OPTIONS = ['自立', '見守り', '一部介助', '全介助'] as const;

export const MEASURE_LABELS = {
  gait: '歩行状態',
  standUp: '立ち上がり',
  assistance: '介助量',
  walkDistanceM: '歩行距離（m）',
} as const;
