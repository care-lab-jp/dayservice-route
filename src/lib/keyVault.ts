/**
 * Google Maps APIキーの保管庫。
 *
 * 【現状の課題と方針】
 * ブラウザから直接Google APIを叩く構成では、キーは必ずブラウザに露出する。
 * したがって「隠す」のではなく「盗まれても被害が出ない」ようにするのが正しい防御であり、
 *   ・HTTPリファラー制限（そのドメイン以外では使えない）
 *   ・API制限（必要な3つのAPIのみ）
 *   ・割り当て(Quota)の上限設定（暴走請求の防止）
 * が実質的な安全装置になる。
 *
 * その上で本アプリでは、デイサービスの共有PC・共有タブレット利用を想定し、
 * 既定の保管場所を sessionStorage（タブを閉じると消える）とした。
 * 施設専用端末で毎回の入力を省きたい場合のみ、明示的に localStorage を選べる。
 *
 * 将来サーバ経由（BFF）へ移行する場合は、この getKey() が
 * 「サーバが発行した短命トークンを取得する」実装に変わるだけで、
 * 呼び出し側（travelProvider / googleRoutes / MapView）は変更不要。
 */
import { localStore } from './storage';

const PREFIX = 'dayservice-route/key/';

function sessionGet(k: string): string | null {
  try { return sessionStorage.getItem(k); } catch { return null; }
}
function sessionSet(k: string, v: string) {
  try { sessionStorage.setItem(k, v); } catch { /* ignore */ }
}
function sessionDel(k: string) {
  try { sessionStorage.removeItem(k); } catch { /* ignore */ }
}

/** テナントのAPIキーを取得（session を優先し、無ければ local） */
export function getTenantKey(tenantId: string): string {
  const k = PREFIX + tenantId;
  return (sessionGet(k) ?? (localStore.getItem(k) as string | null) ?? '').trim();
}

/** テナントのAPIキーを保存。storage='session' なら端末に残さない */
export function setTenantKey(tenantId: string, key: string, storage: 'session' | 'local') {
  const k = PREFIX + tenantId;
  const v = key.trim();
  // どちらに切り替える場合も、もう一方には残さない
  sessionDel(k);
  localStore.removeItem(k);
  if (!v) return;
  if (storage === 'local') localStore.setItem(k, v);
  else sessionSet(k, v);
}

export function clearTenantKey(tenantId: string) {
  const k = PREFIX + tenantId;
  sessionDel(k);
  localStore.removeItem(k);
}

/** そのキーが端末に永続保存されているか（画面での注意表示に使う） */
export function isKeyPersisted(tenantId: string): boolean {
  return !!localStore.getItem(PREFIX + tenantId);
}

/** キーの見た目だけの検証（Googleのキーは "AIza" 始まりの39文字が一般的） */
export function looksLikeApiKey(key: string): boolean {
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(key.trim());
}

/** 画面表示用のマスク（AIzaSy****…****abcd） */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length < 12) return '****';
  return `${k.slice(0, 6)}${'*'.repeat(8)}${k.slice(-4)}`;
}
