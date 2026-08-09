/**
 * 保存先の抽象化レイヤ。
 * MVPでは LocalStorage を使うが、ここを差し替えるだけで
 * Firebase / Supabase / 独自バックエンド へ移行できる。
 *
 * 【個人情報保護】
 * ここに保存されるデータ（氏名・住所など）はブラウザ内にのみ存在し、
 * 外部へ送信されない。外部APIへ渡すのは lib/travelProvider.ts が扱う
 * 緯度経度と匿名IDのみ。
 */
export interface KeyValueStore {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

import { reportStorageFailure } from './saveStatus';

export const localStore: KeyValueStore = {
  getItem: (k) => {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      // 握りつぶさない：保存できていないことを必ず画面へ知らせる
      console.error('[storage] 保存に失敗しました', e);
      reportStorageFailure(e);
    }
  },
  removeItem: (k) => {
    try { localStorage.removeItem(k); } catch { /* 削除失敗は致命的でない */ }
  },
};

/** 将来ここを差し替える（例: supabaseStore） */
export const activeStore: KeyValueStore = localStore;
