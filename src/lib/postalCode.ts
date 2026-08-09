/**
 * 郵便番号から住所を引く（zipcloud API）。
 *
 * ・APIキー不要・無料で、Googleの契約が無くても使える
 * ・送信するのは郵便番号7桁のみ（氏名・住所・座標は送らない）
 * ・エンドポイント: https://zipcloud.ibsnet.co.jp/api/search
 *
 * 住所→座標の変換は別処理（travelProvider.geocodeAddress）。
 * ここで得られるのは町域までで、番地は職員が追記する前提。
 */
import { classifyThrown, makeError, type ApiError } from './apiErrors';

export interface PostalAddress {
  /** 都道府県 + 市区町村 + 町域 を連結した住所 */
  address: string;
  prefecture: string;
  city: string;
  town: string;
  /** ハイフンつきに整形した郵便番号 */
  formattedZip: string;
}

/** "6008216" / "600-8216" / "〒600-8216" → "6008216" */
export function normalizeZip(input: string): string {
  return (input ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角→半角
    .replace(/[^0-9]/g, '');
}

/** "6008216" → "600-8216" */
export function formatZip(zip7: string): string {
  return zip7.length === 7 ? `${zip7.slice(0, 3)}-${zip7.slice(3)}` : zip7;
}

export function isValidZip(input: string): boolean {
  return normalizeZip(input).length === 7;
}

export async function lookupPostalCode(input: string): Promise<PostalAddress> {
  const zip = normalizeZip(input);
  if (zip.length !== 7) throw makeError('NOT_FOUND', '郵便番号は7桁で入力してください');

  let res: Response;
  try {
    res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
  } catch (e) {
    throw classifyThrown(e);
  }
  if (!res.ok) throw makeError('NETWORK', `HTTP ${res.status}`);

  let json: {
    status?: number;
    message?: string | null;
    results?: { address1: string; address2: string; address3: string }[] | null;
  };
  try {
    json = await res.json();
  } catch (e) {
    throw classifyThrown(e);
  }

  if (json.status !== 200) throw makeError('UNKNOWN', json.message ?? '郵便番号を検索できませんでした');
  const top = json.results?.[0];
  if (!top) throw makeError('NOT_FOUND', 'この郵便番号に該当する住所が見つかりませんでした');

  return {
    address: `${top.address1}${top.address2}${top.address3}`,
    prefecture: top.address1,
    city: top.address2,
    town: top.address3,
    formattedZip: formatZip(zip),
  };
}

/** 失敗してもアプリを止めないラッパー */
export async function tryLookupPostalCode(
  input: string
): Promise<{ result: PostalAddress | null; error: ApiError | null }> {
  try {
    return { result: await lookupPostalCode(input), error: null };
  } catch (e) {
    const err = (e as ApiError)?.code ? (e as ApiError) : classifyThrown(e);
    return { result: null, error: err };
  }
}
