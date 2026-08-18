/**
 * アプリ全体のデータ型。
 * ここを拡張すれば「複数車両」「曜日設定」などへ広げられる。
 */

export type LatLng = { lat: number; lng: number };

/**
 * テナント（施設事業者）。SaaS化に備え、データは必ずこのIDで分離する。
 * ・保存キー          : dayservice-route/t/<tenantId>
 * ・Google APIキー    : テナントごとに保持（＝認証・課金主体を施設単位で切替）
 */
export interface Tenant {
  id: string;
  name: string;
  /**
   * APIキーの利用方式。
   *  own    : 施設自身のGoogle Cloudプロジェクトのキー（＝施設が課金主体。本番の既定）
   *  shared : 運営者の共通キー（環境変数）。開発・デモ・体験利用のみを想定
   *  none   : キーを使わない（デモモード）
   */
  keyMode: 'own' | 'shared' | 'none';
  /**
   * APIキーの保管場所。
   *  session : タブを閉じると消える（共有端末の既定）
   *  local   : この端末に保存（施設専用端末向けの明示的な選択）
   * ※キー本体は Tenant には持たせず lib/keyVault.ts が管理する
   */
  keyStorage: 'session' | 'local';
  /** Advanced Marker 用の Map ID。未設定時は開発用の DEMO_MAP_ID */
  mapId?: string;
  /**
   * 交通状況を考慮するか。
   * true（既定）: 出発時刻の交通状況で計算（Routes API の Pro SKU 課金）
   * false        : 道路条件のみで計算（TRAFFIC_UNAWARE / Essentials SKU・費用が安い）
   */
  useTraffic?: boolean;
  createdAt: string;
  /** @deprecated v3以前の互換用。keyMode へ移行済み */
  useOwnKey?: boolean;
  /** @deprecated v3以前の互換用。キーは keyVault が保持する */
  mapsApiKey?: string;
}

/** 施設（拠点） */
export interface Facility {
  id: string;
  /** 所属テナント */
  tenantId?: string;
  name: string;
  postalCode: string;
  address: string;
  lat: number;
  lng: number;
  /** 送迎開始地点（未指定なら施設と同じ） */
  startPoint?: LatLng & { label: string };
  /** 送迎終了地点（未指定なら施設と同じ） */
  endPoint?: LatLng & { label: string };
  /** 施設への到着希望時刻 "HH:MM"（送りの場合は出発時刻） */
  arriveBy: string;
}

/** 利用者 */
export interface Member {
  id: string;
  /** 表示名（個人情報。外部APIへは送らない） */
  name: string;
  postalCode: string;
  address: string;
  lat: number;
  lng: number;
  /** お迎え希望時間（開始・終了） */
  pickupFrom: string; // "08:20"
  pickupTo: string;   // "08:35"
  /** お送り希望時間（MVPでは表示のみ／将来の復路用） */
  dropoffFrom: string;
  dropoffTo: string;
  /** 乗車にかかる時間の補正（分）。車いす等で長くなる人に加算 */
  boardingMinutes: number;
  /** 車内に乗っていられる上限（分）。体力面の配慮。未設定は既定値(40分)を使用 */
  maxRideMinutes?: number;
  /** 車いす対応車両が必要か */
  requiresWheelchair?: boolean;
  note: string;
  active: boolean;
}

/** 車両（MVPは1台。データ構造は複数台対応） */
export interface Vehicle {
  id: string;
  name: string;      // 車両A
  capacity: number;  // 定員
  wheelchair: boolean;
  active: boolean;
}

/** 1件の停車予定 */
export interface Stop {
  memberId: string;
  /** 匿名ID：地図や外部APIにはこちらを使う（利用者A, 利用者B ...） */
  anonId: string;
  order: number;
  /** 到着予定（分・0時からの通算） */
  arriveMin: number;
  /** 出発予定（到着＋乗車時間） */
  departMin: number;
  /** 直前地点からの移動時間（分） */
  travelMin: number;
  /** 希望時間帯より早く着いてしまう待ち時間（分） */
  waitMin: number;
  /** 希望終了時刻に対する遅れ（分, 0なら間に合う） */
  lateMin: number;
  /** 乗車してから施設到着までの車内滞在時間（分） */
  rideMin?: number;
  /** 直前地点からの道路距離（km）。Google連携時のみ実距離 */
  distanceKm?: number;
  /** この区間の移動時間が推定値（Googleから取得できず補完した）か */
  estimated?: boolean;
  /** 通常時（渋滞なし・historical）の移動時間（分） */
  staticTravelMin?: number;
  /** 交通による増加分（分） = travelMin - staticTravelMin */
  trafficDelayMin?: number;
}

/** ルート上の交通状況（Routes API の speedReadingIntervals） */
export type TrafficSpeed = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';
export interface TrafficInterval {
  startIndex: number;
  endIndex: number;
  speed: TrafficSpeed;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface RouteIssue {
  level: IssueLevel;
  title: string;
  detail: string;
  suggestions: string[];
}

/** ルート計算の結果 */
export interface RoutePlan {
  vehicleId: string;
  /** 出発時刻（分） */
  departMin: number;
  stops: Stop[];
  /** 施設帰着予定（分） */
  returnMin: number;
  /** 最後の停車から施設までの移動時間 */
  lastLegMin: number;
  totalTravelMin: number;
  /** 総走行距離（km） */
  totalDistanceKm?: number;
  /** 実際の道路に沿ったルート形状（Googleのエンコード済みポリライン） */
  encodedPolyline?: string;
  /** ルート上の交通状況（渋滞の可視化に使用） */
  trafficIntervals?: TrafficInterval[];
  /** 通常時（渋滞なし）の総移動時間 */
  staticTravelMin?: number;
  /** 交通による総増加時間 */
  trafficDelayMin?: number;
  /** 交通予測の基準にした出発時刻（ISO8601） */
  departureTimeIso?: string;
  /** 推定値で補完した区間の数（0なら全区間が実データ） */
  estimatedLegCount?: number;
  /** 実際に使用したルーティング設定 */
  routingPreference?: 'TRAFFIC_AWARE_OPTIMAL' | 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE' | 'DUMMY';
  /** おすすめ出発時刻（通算分）。全員間に合う中で最も遅い時刻 */
  recommendedDepartMin?: number;
  /** おすすめ出発時刻の理由 */
  recommendedDepartReason?: 'ok' | 'earlier' | 'later' | 'impossible';
  /** 最遅出発可能時刻（これより遅いと条件を満たせない）。無理なら null */
  latestDepartMin?: number | null;
  issues: RouteIssue[];
  /** 移動時間の出所 */
  travelSource: 'google' | 'dummy';
  createdAt: string;
}

/**
 * 1日分の送迎計画。複数車両へ拡張するための入れ物。
 * MVPでは routes は1件だが、車両を増やせば routes が増える構造。
 */
export interface DayPlan {
  /** 前回ルートとの比較用に、作成時の利用者IDセットを保持 */
  memberIds?: string[];
  /**
   * 作成時点の設定の指紋。
   * 現在の設定と突き合わせて「この送迎表は今の情報と一致しているか」を判定する。
   */
  snapshot?: PlanSnapshot;
  tenantId: string;
  facilityId: string;
  /** YYYY-MM-DD */
  date: string;
  departTime: string;
  routes: RoutePlan[];
  createdAt: string;
}

/** 計画作成時点の設定の指紋（整合性判定に使う） */
export interface PlanSnapshot {
  facility: string;
  departTime: string;
  /** memberId -> 指紋 */
  members: Record<string, string>;
  /** vehicleId -> 指紋 */
  vehicles: Record<string, string>;
}

/** 送迎表が現在の設定と一致しているか */
export type PlanStatus = 'READY' | 'STALE' | 'OUTDATED';

export interface PlanFreshness {
  status: PlanStatus;
  /** 職員向けの理由（例：「田中さんの住所が変更されています」） */
  reasons: string[];
  /** 送迎表に含まれるが、現在は存在しない利用者のID */
  missingMemberIds: string[];
  /** 送迎表に含まれるが、現在は無効になっている利用者のID */
  inactiveMemberIds: string[];
}

/** 過去ルートの履歴（比較・再利用のために軽量化して保持） */
export interface RouteHistoryEntry {
  id: string;
  date: string;          // YYYY-MM-DD
  createdAt: string;
  departTime: string;
  memberIds: string[];   // 利用した人（構成が同じか判定するのに使う）
  /** 車両ごとの巡回順（memberIdの配列） */
  orders: { vehicleId: string; memberIds: string[] }[];
  /** 集計値のみ保持（ポリライン等は保存しない） */
  totalTravelMin: number;
  returnMin: number;
  hadError: boolean;
}

/* ==================================================================
 * 支援記録（v0.5.0で追加）
 * 送迎ルート機能とは独立したデータ。Member 型は変更していないため、
 * 記録を追加・編集しても作成済みの送迎表が「要再作成」にはならない。
 * ================================================================== */

/** 利用開始時／現在の状態。すべて任意で、未入力は undefined のまま保持する */
export interface SupportMeasures {
  /** 歩行状態（選択式のラベルをそのまま保持） */
  gait?: string;
  /** 立ち上がり */
  standUp?: string;
  /** 介助量 */
  assistance?: string;
  /** 歩行距離（m） */
  walkDistanceM?: number;
}

/** 1回ぶんの支援記録 */
export interface SupportRecord {
  recordId: string;
  memberId: string;
  createdAt: string;
  updatedAt: string;
  /** チェックした項目のID（supportCatalog の SupportItem.id） */
  checkedItems: string[];
  baseline?: SupportMeasures;
  current?: SupportMeasures;
  /** 職員が書いた補足メモ（そのまま文章に載る） */
  note?: string;
  /** 組み立てた文章 */
  generatedText: string;
  /** 職員が修正した文章（あればこちらを正とする） */
  editedText?: string;
}
