/**
 * マルチテナント（複数施設）対応の中核。
 *
 * ・保存キーを dayservice-route/t/<tenantId> に分けることで、
 *   施設ごとにデータを完全分離する（他施設のデータは読み書きできない）。
 * ・Google Maps のAPIキーもテナント単位で保持できるため、
 *   認証・課金の主体を施設ごとに切り替えられる。
 *
 * 将来サーバへ移行する場合も、この tenantId をそのまま
 *   Firestore: /tenants/{tenantId}/members/...
 *   Supabase : row level security の tenant_id 列
 * に対応させれば分離構造を維持できる。
 */
import { create } from 'zustand';
import type { Tenant } from '../types';
import { localStore } from './storage';
import { clearTenantKey, getTenantKey } from './keyVault';

const TENANT_INDEX_KEY = 'dayservice-route/tenants';

/** テナントごとのアプリデータ保存キー */
export function appStorageKey(tenantId: string): string {
  return `dayservice-route/t/${tenantId}`;
}

interface TenantIndex {
  tenants: Tenant[];
  currentId: string;
}

const DEFAULT_TENANT: Tenant = {
  id: 'tenant-default',
  name: 'さくらデイサービスセンター',
  // 既定はデモ（共通キーがあればそれを使う）。実運用の施設は 'own' に切り替える
  keyMode: 'shared',
  keyStorage: 'session',
  createdAt: new Date().toISOString(),
};

/** v3以前のテナント定義を新形式へ移行する */
function migrateTenant(t: Tenant): Tenant {
  if (t.keyMode) return t;
  const legacy = t as Tenant & { useOwnKey?: boolean; mapsApiKey?: string };
  const keyMode: Tenant['keyMode'] = legacy.useOwnKey ? 'own' : 'shared';
  // 旧実装で localStorage に平文保存されていたキーは keyVault(local) へ移す
  if (legacy.useOwnKey && legacy.mapsApiKey) {
    try {
      localStore.setItem('dayservice-route/key/' + t.id, legacy.mapsApiKey);
    } catch { /* ignore */ }
  }
  return { ...t, keyMode, keyStorage: 'local', mapsApiKey: undefined, useOwnKey: undefined };
}

/** localStorage から同期で読む（ストア初期化時に必要） */
export function readTenantIndexSync(): TenantIndex {
  try {
    const raw = localStore.getItem(TENANT_INDEX_KEY) as string | null;
    if (raw) {
      const parsed = JSON.parse(raw) as TenantIndex;
      if (parsed?.tenants?.length && parsed.currentId) {
        return { ...parsed, tenants: parsed.tenants.map(migrateTenant) };
      }
    }
  } catch { /* 破損時は既定値へ */ }
  return { tenants: [DEFAULT_TENANT], currentId: DEFAULT_TENANT.id };
}

function writeTenantIndex(idx: TenantIndex) {
  localStore.setItem(TENANT_INDEX_KEY, JSON.stringify(idx));
}

interface TenantState extends TenantIndex {
  current: () => Tenant;
  addTenant: (name: string) => Tenant;
  updateTenant: (id: string, patch: Partial<Tenant>) => void;
  removeTenant: (id: string) => void;
  setCurrentId: (id: string) => void;
}

export const useTenantStore = create<TenantState>((set, get) => ({
  ...readTenantIndexSync(),

  current: () => {
    const { tenants, currentId } = get();
    return tenants.find((t) => t.id === currentId) ?? tenants[0];
  },
  addTenant: (name) => {
    const t: Tenant = {
      id: 'tenant-' + Math.random().toString(36).slice(2, 10),
      name: name.trim() || '新しい施設',
      // 新規施設は「自施設のGoogle Cloud契約を使う」を既定とする
      keyMode: 'own',
      keyStorage: 'session',
      createdAt: new Date().toISOString(),
    };
    const next = { tenants: [...get().tenants, t], currentId: get().currentId };
    set(next); writeTenantIndex(next);
    return t;
  },
  updateTenant: (id, patch) => {
    const next = {
      tenants: get().tenants.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      currentId: get().currentId,
    };
    set(next); writeTenantIndex(next);
  },
  removeTenant: (id) => {
    const rest = get().tenants.filter((t) => t.id !== id);
    if (rest.length === 0) return;
    // 施設を削除したらその施設のデータとAPIキーも消す（分離の徹底）
    localStore.removeItem(appStorageKey(id));
    clearTenantKey(id);
    const next = { tenants: rest, currentId: get().currentId === id ? rest[0].id : get().currentId };
    set(next); writeTenantIndex(next);
  },
  setCurrentId: (id) => {
    const next = { tenants: get().tenants, currentId: id };
    set(next); writeTenantIndex(next);
  },
}));

/** React外から現在のテナントを取得 */
export function currentTenant(): Tenant {
  return useTenantStore.getState().current();
}

/**
 * 使用するGoogle Maps APIキーを決定する。
 *
 *  keyMode='own'    -> keyVault に保管された施設自身のキー（課金主体＝その施設）★本番の原則
 *  keyMode='shared' -> 環境変数の共通キー（開発・デモ・体験利用のみ）
 *  keyMode='none'   -> キーなし（デモモード）
 */
export function resolveApiKey(envKey: string): string {
  const t = currentTenant();
  if (!t) return '';
  if (t.keyMode === 'own') return getTenantKey(t.id);
  if (t.keyMode === 'shared') return envKey;
  return '';
}

/** Advanced Marker 用の Map ID。未設定なら開発用の DEMO_MAP_ID */
export function resolveMapId(): string {
  return currentTenant()?.mapId?.trim() || 'DEMO_MAP_ID';
}

/** 共通キーが用意されているか（＝デモ・体験利用が可能か） */
export function isSharedKeyConfigured(envKey: string): boolean {
  return envKey.length > 0;
}
