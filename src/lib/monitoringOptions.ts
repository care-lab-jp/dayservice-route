/**
 * モニタリング報告の選択肢（原本の様式に合わせた文言）。
 * 画面とExcel生成の両方から使う。
 */
export const IMPLEMENTATION_OPTIONS = ['計画通り実施できた', '一部実施できた', '未実施'] as const;
export const ACHIEVEMENT_OPTIONS = ['達成', '一部達成', '未達成'] as const;
export const SATISFACTION_OPTIONS = ['満足', 'ある程度満足', '不満'] as const;
export const DIRECTION_OPTIONS = [
  'サービスを継続', 'サービス内容変更して継続', 'サービスを中止',
] as const;
