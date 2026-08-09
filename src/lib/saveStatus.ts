/**
 * 保存の成否を画面に伝えるためのストア。
 * LocalStorage は容量制限（一般に数MB程度。ブラウザ・環境により異なる）や
 * プライベートモードの制限で書き込みに失敗することがある。
 * 失敗を黙って握りつぶすと「登録したはずのデータが翌日消えている」事故になるため、
 * 必ず職員に見える形で通知する。
 */
import { create } from 'zustand';

interface SaveStatusState {
  failed: boolean;
  message: string;
  detail: string;
  at: string | null;
  reportFailure: (message: string, detail?: string) => void;
  reportSuccess: () => void;
}

export const useSaveStatus = create<SaveStatusState>((set) => ({
  failed: false,
  message: '',
  detail: '',
  at: null,
  reportFailure: (message, detail = '') =>
    set({ failed: true, message, detail, at: new Date().toISOString() }),
  // 一度失敗したら、成功しても自動では消さない（職員がバックアップを取る判断をするため）
  reportSuccess: () => set((s) => (s.failed ? s : { ...s })),
}));

export function reportStorageFailure(e: unknown) {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const quota = /quota|exceeded|storage/i.test(raw);
  useSaveStatus.getState().reportFailure(
    quota
      ? 'データを保存できませんでした（保存容量が不足している可能性があります）'
      : 'データを保存できませんでした',
    raw
  );
}
