/**
 * Google Maps Platform のエラーを、職員が読んで分かる日本語メッセージに変換する。
 * どのAPIで失敗しても、ここを通してから画面に出す。
 */
export type ApiErrorCode =
  | 'NO_KEY'
  | 'INVALID_KEY'
  | 'API_NOT_ENABLED'
  | 'REFERER_BLOCKED'
  | 'REFERER_UNSUPPORTED'
  | 'MAPS_AUTH'
  | 'QUOTA'
  | 'NOT_FOUND'
  | 'NO_ROUTE'
  | 'TOO_MANY'
  | 'NETWORK'
  | 'UNKNOWN';

export interface ApiError {
  code: ApiErrorCode;
  /** 画面に出す短い説明 */
  message: string;
  /** 対処方法 */
  hint: string;
  /** 開発者向けの原文 */
  raw?: string;
}

const TABLE: Record<ApiErrorCode, { message: string; hint: string }> = {
  NO_KEY: {
    message: 'Google Maps のAPIキーが設定されていません',
    hint: 'デモモードで動作します。連携するには .env に VITE_GOOGLE_MAPS_API_KEY を設定してください。',
  },
  INVALID_KEY: {
    message: 'APIキーが正しくありません',
    hint: '.env のキーに余分な空白や改行がないか、Google Cloud で削除されていないかを確認してください。',
  },
  API_NOT_ENABLED: {
    message: 'このAPIがGoogle Cloudで有効になっていません',
    hint: 'Google Cloud コンソールで Maps JavaScript API / Geocoding API / Routes API を有効化してください（反映に数分かかることがあります）。',
  },
  REFERER_BLOCKED: {
    message: 'APIキーの利用制限でブロックされました',
    hint: 'キーのHTTPリファラー制限に http://localhost:5173/* を追加してください。',
  },
  REFERER_UNSUPPORTED: {
    message: 'このAPIはウェブサイト制限つきのキーでは利用できません',
    hint: 'アプリ側で地図ライブラリ経由の検索に切り替えます。それでも解決しない場合は、緯度・経度を直接入力してください。',
  },
  MAPS_AUTH: {
    message: '地図の認証に失敗しました',
    hint: 'APIキーが正しいか、Maps JavaScript API が有効か、キーのHTTPリファラー制限に この画面のURL（例: http://localhost:5173/*）が含まれているかをご確認ください。',
  },
  QUOTA: {
    message: 'Google Maps の利用上限に達しました',
    hint: '時間をおいて再度お試しください。請求先アカウントの設定や割り当て（Quota）もご確認ください。',
  },
  NOT_FOUND: {
    message: '住所が見つかりませんでした',
    hint: '住所の表記を変えて再検索するか、緯度・経度を直接入力してください。',
  },
  NO_ROUTE: {
    message: '道路のルートを取得できませんでした',
    hint: '座標が海上や道路のない場所になっていないかご確認ください。',
  },
  TOO_MANY: {
    message: '一度に計算できる人数を超えています',
    hint: '利用者を複数の車両（便）に分けてから、もう一度ルートを作成してください。',
  },
  NETWORK: {
    message: 'ネットワークに接続できませんでした',
    hint: 'インターネット接続を確認して、もう一度お試しください。',
  },
  UNKNOWN: {
    message: 'Google Maps との通信に失敗しました',
    hint: '時間をおいて再度お試しください。解消しない場合は施設設定の状態表示をご確認ください。',
  },
};

export function makeError(code: ApiErrorCode, raw?: string): ApiError {
  return { code, ...TABLE[code], raw };
}

/** fetch のレスポンス（REST系API）からエラー種別を判定する */
export async function classifyRestError(res: Response): Promise<ApiError> {
  let raw = '';
  let status = '';
  let message = '';
  try {
    const json = await res.json();
    raw = JSON.stringify(json);
    status = json?.error?.status ?? '';
    message = json?.error?.message ?? '';
  } catch {
    raw = `HTTP ${res.status}`;
  }
  const m = message.toLowerCase();

  if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') return makeError('QUOTA', raw);
  if (m.includes('api key not valid') || m.includes('api key expired')) return makeError('INVALID_KEY', raw);
  if (m.includes('has not been used in project') || m.includes('is disabled')) return makeError('API_NOT_ENABLED', raw);
  if (m.includes('referer') || m.includes('referrer')) return makeError('REFERER_BLOCKED', raw);
  if (res.status === 403 || status === 'PERMISSION_DENIED') return makeError('API_NOT_ENABLED', raw);
  if (res.status === 400 || status === 'INVALID_ARGUMENT') return makeError('INVALID_KEY', raw);
  return makeError('UNKNOWN', raw);
}

/** Geocoding API（status文字列を返す旧来型）の判定 */
export function classifyGeocodeStatus(status: string, errorMessage?: string): ApiError {
  switch (status) {
    case 'ZERO_RESULTS':
      return makeError('NOT_FOUND', errorMessage);
    case 'OVER_QUERY_LIMIT':
    case 'OVER_DAILY_LIMIT':
      return makeError('QUOTA', errorMessage);
    case 'REQUEST_DENIED': {
      const m = (errorMessage ?? '').toLowerCase();
      // 「リファラー制限つきキーはこのAPIで使えない」を無効キーと誤判定しない
      if (m.includes('referer') || m.includes('referrer')) {
        return makeError('REFERER_UNSUPPORTED', errorMessage);
      }
      if (m.includes('not authorized') || m.includes('api key')) {
        return makeError('INVALID_KEY', errorMessage);
      }
      return makeError('API_NOT_ENABLED', errorMessage);
    }
    case 'INVALID_REQUEST':
      return makeError('NOT_FOUND', errorMessage);
    default:
      return makeError('UNKNOWN', `${status} ${errorMessage ?? ''}`);
  }
}

/** 例外（主にネットワーク断）の判定 */
export function classifyThrown(e: unknown): ApiError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed|timeout/i.test(msg)) return makeError('NETWORK', msg);
  return makeError('UNKNOWN', msg);
}
