/**
 * データアクセスの抽象化（Repository）。
 *
 * 目的：サーバ移行時に「画面」と「ストア」を書き直さずに済むようにすること。
 * 現在の LocalStorage 実装も、将来の Firestore / Supabase 実装も、
 * この TenantRepository インターフェースを満たすだけでよい。
 *
 * 集約（aggregate）の単位は「テナント1件ぶんの業務データ」。
 * 送迎業務は1施設のデータをまとめて読み書きするため、
 * 細かいエンティティ単位のCRUDよりも扱いやすく、
 * Firestore のドキュメント1件／Supabase の1行にも自然に対応する。
 *
 * 想定マッピング：
 *   Firestore : /tenants/{tenantId}/app/data           （1ドキュメント）
 *               /tenants/{tenantId}/members/{memberId} （分割したい場合）
 *   Supabase  : app_data テーブル + RLS: tenant_id = auth.jwt() ->> 'tenant_id'
 */
import type {
  DayPlan, Facility, Member, MonitoringRecord, RouteHistoryEntry, SupportRecord, Vehicle,
} from '../types';
import { activeStore } from './storage';
import { appStorageKey } from './tenant';

/** テナント1件ぶんの業務データ（zustand persist が保存する state と同形） */
export interface PersistedAppData {
  facility: Facility;
  members: Member[];
  vehicles: Vehicle[];
  selectedIds: string[];
  departTime: string;
  vehicleId: string;
  dayPlan: DayPlan | null;
  activeRouteIndex: number;
  manualOrder: string[] | null;
  history: RouteHistoryEntry[];
  /** 支援記録（要配慮情報を含むため、書き出しは既定で除外） */
  supportRecords: SupportRecord[];
  /** モニタリング記録（同上） */
  monitoringRecords: MonitoringRecord[];
}

/** 保存形式（zustand persist の入れ物に合わせる） */
interface Envelope {
  state: PersistedAppData;
  version: number;
}

export interface TenantRepository {
  /** テナントの業務データを読む。無ければ null */
  load(tenantId: string): Promise<PersistedAppData | null>;
  /** 業務データを保存する */
  save(tenantId: string, data: PersistedAppData): Promise<void>;
  /** テナントの業務データを完全に削除する */
  clear(tenantId: string): Promise<void>;
  /** バックアップ用JSON文字列を作る（APIキーと当日のルートは含めない） */
  exportJson(tenantId: string, options?: ExportOptions): Promise<string>;
  /** 取り込む前に中身だけ確認する */
  inspectJson(json: string): ImportPreview;
  /** バックアップJSONを取り込む（既存データは自動退避してから置き換え） */
  importJson(tenantId: string, json: string, options?: ImportOptions): Promise<PersistedAppData>;
  /** 直前の取り込みを取り消す（取り込み前の状態へ戻す） */
  undoImport(tenantId: string): Promise<PersistedAppData | null>;
}

export const SCHEMA_VERSION = 6;

/** 取り込み時の検証エラー（画面で分岐できるようコード付き） */
export type ImportErrorCode =
  | 'UNKNOWN_FORMAT'
  | 'FUTURE_VERSION'
  | 'TENANT_MISMATCH'
  | 'INVALID_DATA';

export class ImportError extends Error {
  constructor(public code: ImportErrorCode, message: string, public detail?: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ExportOptions {
  /** 過去ルートの履歴も含めるか（既定：含めない） */
  includeHistory?: boolean;
  /** 支援記録・モニタリング記録も含めるか（既定：含めない。要配慮情報を含むため） */
  includeSupportRecords?: boolean;
}

export interface ImportOptions {
  /** 別施設のバックアップと分かった上で取り込むか */
  allowTenantMismatch?: boolean;
}

export interface ImportPreview {
  tenantId?: string;
  schemaVersion?: number;
  exportedAt?: string;
  memberCount: number;
  vehicleCount: number;
  facilityName: string;
}

/** 00:00〜23:59 のみを妥当とみなす（25:99 のような値を弾く） */
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** バックアップの中身が壊れていないかを最低限チェックする */
function validate(data: unknown): asserts data is PersistedAppData {
  const d = data as PersistedAppData;
  if (!d || typeof d !== 'object') throw new ImportError('UNKNOWN_FORMAT', 'ファイルの形式が不正です');
  if (!d.facility || typeof d.facility !== 'object') {
    throw new ImportError('INVALID_DATA', '施設情報が見つかりません');
  }
  if (!Array.isArray(d.members)) {
    throw new ImportError('INVALID_DATA', '利用者情報が見つかりません');
  }
  if (typeof d.facility.lat !== 'number' || typeof d.facility.lng !== 'number') {
    throw new ImportError('INVALID_DATA', '施設の緯度・経度が数値ではありません');
  }
  d.members.forEach((m, i) => {
    const where = `${i + 1}件目の利用者`;
    if (!m || typeof m.id !== 'string' || typeof m.name !== 'string') {
      throw new ImportError('INVALID_DATA', `${where}の形式が不正です`);
    }
    if (typeof m.lat !== 'number' || typeof m.lng !== 'number' || Number.isNaN(m.lat)) {
      throw new ImportError('INVALID_DATA', `${where}（${m.name}）の緯度・経度が不正です`);
    }
    if (!HHMM.test(m.pickupFrom) || !HHMM.test(m.pickupTo)) {
      throw new ImportError('INVALID_DATA', `${where}（${m.name}）のお迎え希望時間が不正です`);
    }
    if (typeof m.boardingMinutes !== 'number' || m.boardingMinutes < 0) {
      throw new ImportError('INVALID_DATA', `${where}（${m.name}）の乗車時間補正が不正です`);
    }
  });
  if (!Array.isArray(d.vehicles)) throw new ImportError('INVALID_DATA', '車両情報が見つかりません');
  if (d.supportRecords !== undefined && !Array.isArray(d.supportRecords)) {
    throw new ImportError('INVALID_DATA', '支援記録の形式が不正です');
  }
  if (d.monitoringRecords !== undefined && !Array.isArray(d.monitoringRecords)) {
    throw new ImportError('INVALID_DATA', 'モニタリング記録の形式が不正です');
  }
}

/** LocalStorage 実装（MVP） */
export class LocalTenantRepository implements TenantRepository {
  async load(tenantId: string): Promise<PersistedAppData | null> {
    const raw = (await activeStore.getItem(appStorageKey(tenantId))) as string | null;
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as Envelope;
      return env?.state ?? null;
    } catch {
      return null;
    }
  }

  async save(tenantId: string, data: PersistedAppData): Promise<void> {
    const env: Envelope = { state: data, version: SCHEMA_VERSION };
    await activeStore.setItem(appStorageKey(tenantId), JSON.stringify(env));
  }

  async clear(tenantId: string): Promise<void> {
    await activeStore.removeItem(appStorageKey(tenantId));
  }

  async exportJson(tenantId: string, options?: ExportOptions): Promise<string> {
    const data = await this.load(tenantId);
    // ・APIキーは元々このデータに含まれない（keyVaultで別管理）
    // ・当日のルート(dayPlan)は一時データで復元価値が低く、ポリラインで肥大化するため除外
    // ・履歴は「誰がいつ送迎されたか」の記録なので既定で除外
    const payload = data
      ? {
          ...data,
          dayPlan: null,
          activeRouteIndex: 0,
          manualOrder: null,
          history: options?.includeHistory ? data.history : [],
          supportRecords: options?.includeSupportRecords ? (data.supportRecords ?? []) : [],
          monitoringRecords: options?.includeSupportRecords ? (data.monitoringRecords ?? []) : [],
        }
      : null;

    return JSON.stringify(
      {
        app: 'dayservice-route',
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        tenantId,
        _warning: options?.includeSupportRecords
          ? 'このファイルには利用者の氏名・住所に加え、身体状況・目標・評価などの要配慮情報（支援記録／モニタリング記録）が含まれます。取り扱いに特にご注意ください。'
          : 'このファイルには利用者の氏名・住所などの個人情報が含まれます。取り扱いにご注意ください。',
        data: payload,
      },
      null,
      2
    );
  }

  inspectJson(json: string): ImportPreview {
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new ImportError('UNKNOWN_FORMAT', 'ファイルを読み取れませんでした（JSONとして不正です）');
    }
    if (parsed?.app && parsed.app !== 'dayservice-route') {
      throw new ImportError('UNKNOWN_FORMAT', 'このファイルは送迎ルートアプリのバックアップではありません');
    }
    const version = Number(parsed?.schemaVersion ?? parsed?.version ?? 0);
    if (version > SCHEMA_VERSION) {
      throw new ImportError(
        'FUTURE_VERSION',
        `新しいバージョン（v${version}）のバックアップです。アプリを更新してから取り込んでください。`
      );
    }
    const data = parsed?.data ?? parsed?.state ?? parsed;
    validate(data);
    return {
      tenantId: parsed?.tenantId,
      schemaVersion: version || undefined,
      exportedAt: parsed?.exportedAt,
      memberCount: data.members.length,
      vehicleCount: data.vehicles.length,
      facilityName: data.facility.name,
    };
  }

  async importJson(
    tenantId: string, json: string, options?: ImportOptions
  ): Promise<PersistedAppData> {
    const preview = this.inspectJson(json);
    if (preview.tenantId && preview.tenantId !== tenantId && !options?.allowTenantMismatch) {
      throw new ImportError(
        'TENANT_MISMATCH',
        `このファイルは別の施設（${preview.facilityName}）のバックアップです。`,
        preview.tenantId
      );
    }

    // 取り消せるように、上書き前の状態を退避しておく
    const current = await this.load(tenantId);
    if (current) {
      await activeStore.setItem(
        appStorageKey(tenantId) + '/before-import',
        JSON.stringify({ state: current, version: SCHEMA_VERSION })
      );
    }

    const parsed = JSON.parse(json);
    const data = (parsed?.data ?? parsed?.state ?? parsed) as PersistedAppData;
    const normalized: PersistedAppData = {
      ...data,
      dayPlan: null,
      activeRouteIndex: 0,
      manualOrder: null,
      history: Array.isArray(data.history) ? data.history : [],
      supportRecords: Array.isArray(data.supportRecords) ? data.supportRecords : [],
      monitoringRecords: Array.isArray(data.monitoringRecords) ? data.monitoringRecords : [],
    };
    await this.save(tenantId, normalized);
    return normalized;
  }

  /** 取り込み直前の状態へ戻す */
  async undoImport(tenantId: string): Promise<PersistedAppData | null> {
    const raw = (await activeStore.getItem(appStorageKey(tenantId) + '/before-import')) as string | null;
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    await this.save(tenantId, env.state);
    return env.state;
  }
}

/** 現在採用しているリポジトリ。ここを差し替えればサーバ移行できる */
export const repository: TenantRepository = new LocalTenantRepository();
