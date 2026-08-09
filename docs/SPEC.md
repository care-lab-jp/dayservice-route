# デイサービス送迎ルート作成アプリ 仕様書

|  |  |
|---|---|
| 文書種別 | 詳細設計仕様書（開発者向け） |
| 対象システム | デイサービス送迎ルート作成アプリ（`dayservice-route`） |
| バージョン | **0.4.2**（実機検証の反映：住所検索経路の変更・表示不具合の修正） |
| 最終更新 | 2026-08-09 |
| 対象読者 | 本アプリを改修・保守する開発者 |
| 併読 | `CHANGELOG.md` / `docs/REVIEW.md`（v0.4.0レビュー）/ `docs/REVIEW-2.md`（現場事故レビュー） |

---

## 目次

1. [システム概要](#1-システム概要)
2. [用語定義](#2-用語定義)
3. [アーキテクチャ](#3-アーキテクチャ)
4. [技術スタック](#4-技術スタック)
5. [データモデル](#5-データモデル)
6. [永続化・マルチテナント・APIキー](#6-永続化マルチテナントapiキー)
7. [外部API連携仕様](#7-外部api連携仕様)
8. [ルート最適化仕様](#8-ルート最適化仕様)
9. [交通状況考慮仕様](#9-交通状況考慮仕様)
10. [整合性管理（送迎表の鮮度）](#10-整合性管理送迎表の鮮度)
11. [画面仕様](#11-画面仕様)
12. [状態管理仕様](#12-状態管理仕様)
13. [エラー処理仕様](#13-エラー処理仕様)
14. [非機能要件](#14-非機能要件)
15. [ビルド・実行仕様](#15-ビルド実行仕様)
16. [テスト](#16-テスト)
17. [運用ガイド（施設向けの前提）](#17-運用ガイド施設向けの前提)
18. [既知の制限と今後](#18-既知の制限と今後)

---

## 1. システム概要

### 1.1 目的

デイサービス施設の職員が毎朝手作業で行っている送迎ルート決定を、**3ステップ・数分**で完了させる。
最短距離を求めるアプリではなく、**「指定した出発時刻に、交通状況を考慮して現実的に回れる順番」**を提示し、
**その結果を職員が安心して使える状態にする**ことを目的とする。

v0.4.1以降は後者、すなわち「**アプリが出した答えの信頼性を職員が判断できること**」を
アルゴリズムの高度化より優先している。

### 1.2 スコープ

| 区分 | 内容 |
|---|---|
| 対象 | 往路（施設 → 利用者宅巡回 → 施設）の1便、車両1台、ブラウザ単独動作、施設ごとのGoogle契約 |
| 対象外（構造のみ用意） | 復路（お送り）、複数車両の自動最適化、サーバ認証、実績記録 |

### 1.3 前提

- 利用者数は1施設あたり最大24名程度（Routes API の1リクエスト上限に由来。[9.3](#93-リクエスト上限)）
- PCまたはタブレット、Chrome / Edge / Safari の最新2バージョン
- **APIキーが無くてもデモモードで全機能が動作する**（オフライン可）

---

## 2. 用語定義

| 用語 | 定義 |
|---|---|
| テナント (Tenant) | 本アプリを利用する施設事業者。データ分離とAPIキー（課金主体）の単位 |
| 施設 (Facility) | 送迎の出発地・帰着地となる拠点。1テナントに1件 |
| 利用者 (Member) | 送迎対象者 |
| 停車 (Stop) | ルート上の1件の立ち寄り |
| ルート (RoutePlan) | 1車両ぶんの巡回計画 |
| 日次計画 (DayPlan) | 1日ぶんの全車両の計画。`routes: RoutePlan[]` |
| 乗車時間補正 | 利用者宅での停車時間（分） |
| 車内時間 (rideMin) | 乗車してから施設に着くまでの時間 |
| 希望時間 | お迎え希望の時間帯 `pickupFrom` 〜 `pickupTo` |
| 遅れ / 待機 | 到着が `pickupTo` を超えた分 / `pickupFrom` より早く着いて待つ分 |
| デモモード | APIキー未設定時の動作。直線距離ベースの推定値で全機能が動く |
| フォールバック | Google API 失敗時に自動で推定値へ退避する動作 |
| 推定値区間 | Googleから所要時間を取得できず、アプリが推定で補完した区間 |
| 鮮度 (PlanFreshness) | 作成済みの送迎表が、現在の登録内容と一致しているかの状態 |

---

## 3. アーキテクチャ

### 3.1 レイヤ構成と依存方向

```
┌──────────────────────────────────────────────┐
│ pages/  Dashboard / RouteCreate / RouteResult /       │
│         Members / FacilitySettings                    │
└───────────────┬──────────────────────────────┘
┌───────────────▼──────────────────────────────┐
│ store/useAppStore   アプリ状態・永続化                 │
│ lib/apiStatus       Google連携の状態                   │
│ lib/saveStatus      保存失敗の通知                     │
└───────────────┬──────────────────────────────┘
┌───────────────▼──────────────────────────────┐
│ lib/planner    画面とエンジンの橋渡し                   │
│                マトリクスのキャッシュ／車両割当           │
└──────┬───────────────────────┬───────────────┘
       │                       │
┌──────▼─────────┐   ┌─────────▼──────────────────┐
│ lib/routeEngine │   │ lib/travelProvider          │
│ lib/freshness   │   │ lib/googleRoutes            │
│  純粋ロジック    │   │ lib/mapsLoader              │
│  地図API非依存   │   │  ★外部通信はこの3つのみ      │
└─────────────────┘   └─────────┬──────────────────┘
                                │
                  ┌─────────────▼──────────────┐
                  │ lib/tenant   APIキーの解決   │
                  │ lib/keyVault キーの保管      │
                  │ lib/apiErrors エラー分類     │
                  │ lib/repository 保存の抽象化  │
                  └────────────────────────────┘
```

### 3.2 設計原則

| 原則 | 内容 |
|---|---|
| 地図APIとロジックの分離 | `routeEngine` は `TravelMatrix`（数値の表）だけを受け取り、Googleの存在を知らない |
| 外部通信の集約 | 外部への通信は `travelProvider` / `googleRoutes` / `mapsLoader` の3ファイルのみ |
| 保存先の抽象化 | `lib/repository.ts` の `TenantRepository` を差し替えればサーバへ移行できる |
| テナント分離の一元化 | 保存キーとAPIキーの解決は `lib/tenant.ts` に集約 |
| 失敗しても止めない | Google側の全失敗はデモモードへ退避し、UIは必ず結果を表示する |
| **整合性は派生値で持つ** | 「作り直しが必要」をフラグで管理せず、作成時の指紋と現状の突き合わせで判定する（立て忘れを構造的に防ぐ） |
| **信頼性を必ず可視化** | 推定値・古いデータ・不一致は、画面と**印刷物の両方**に明示する |

### 3.3 ファイル構成

```
dayservice-route/
├─ index.html / vite.config.ts / tailwind.config.js / vitest.config.ts
├─ .env.example              共通キー（開発・デモ用）の雛形
├─ CHANGELOG.md
├─ docs/  SPEC.md（本書） / REVIEW.md / REVIEW-2.md
└─ src/
   ├─ main.tsx / App.tsx / index.css / types.ts / vite-env.d.ts
   ├─ data/sampleData.ts     架空のデモデータ
   ├─ store/useAppStore.ts   アプリ状態（zustand + persist）/ テナント切替 / 書出・取込
   ├─ lib/
   │  ├─ time.ts             "HH:MM" ⇔ 通算分
   │  ├─ geo.ts              距離・推定移動時間・同一地点判定
   │  ├─ storage.ts          KeyValueStore（失敗を通知する）
   │  ├─ saveStatus.ts       保存失敗の状態
   │  ├─ repository.ts       TenantRepository（検証つき書出・取込）
   │  ├─ tenant.ts           テナント管理・保存キー・APIキー方式
   │  ├─ keyVault.ts         APIキーの保管（session/local）
   │  ├─ apiErrors.ts        Googleエラーの分類と日本語化
   │  ├─ apiStatus.ts        連携状態（demo / google / fallback）
   │  ├─ mapsLoader.ts       Maps JavaScript API の読み込み（地図と住所検索で共用）
   │  ├─ travelProvider.ts   移動時間マトリクス（Dummy/Google）＋住所検索
   │  ├─ googleRoutes.ts     computeRoutes（ルート形状・渋滞）＋ポリライン復号
   │  ├─ routeEngine.ts      ★最適化・時刻計算・警告生成（純粋関数）
   │  ├─ freshness.ts        ★送迎表の鮮度判定（READY / STALE / OUTDATED）
   │  ├─ planner.ts          キャッシュ・車両割当・DayPlan生成・並べ替えガード
   │  └─ __tests__/          シナリオテスト（vitest, 83件）
   ├─ components/  Layout.tsx / MapView.tsx
   └─ pages/       Dashboard / RouteCreate / RouteResult / Members / FacilitySettings
```

---

## 4. 技術スタック

| 分類 | 採用 | 版 | 備考 |
|---|---|---|---|
| UI | React | 18.3 | |
| 言語 | TypeScript | 5.6 | `strict` + `noUnusedLocals` + `noUnusedParameters` |
| ビルド | Vite | 5.4 | `.env` の `VITE_` 前置きで環境変数 |
| スタイル | Tailwind CSS | 3.4 | クラス定義は `index.css` の `@layer components` に集約 |
| 状態管理 | zustand | 4.5 | persist の保存先を動的に切替（テナント分離） |
| ルーティング | react-router-dom | 6.26 | `HashRouter`（静的配信で追加設定が不要） |
| テスト | vitest | 2.1 | 開発時のみ |

**Google Maps 連携のための追加ライブラリは使用していない**（`fetch` とスクリプト動的読み込みのみ）。

### 4.1 Tailwind 設定上の注意（実機で踏んだ罠）

`theme.extend.colors` に **`base` という名前を付けてはいけない**。
`text-base`（文字サイズ）が色ユーティリティとして解釈され、
`.btn-sm { @apply text-base }` の文字色がほぼ白になる事故が発生した。
現在は `pageBg` に改名済み。同種の衝突語：`base`, `sm`, `lg`, `xl`, `left`, `center` など。

---

## 5. データモデル

すべて `src/types.ts` に定義。

### 5.1 Tenant

| フィールド | 型 | 説明 |
|---|---|---|
| `id` / `name` | string | テナントID（保存キーの主キー）／施設事業者名 |
| `keyMode` | `'own' \| 'shared' \| 'none'` | `own`＝施設自身のキー（**既定・課金主体＝施設**）／`shared`＝共通キー（開発・デモ限定）／`none`＝デモモード |
| `keyStorage` | `'session' \| 'local'` | キーの保管場所。既定 `session`（タブを閉じるまで） |
| `mapId` | string? | Advanced Marker 用 Map ID。未設定時のみ `DEMO_MAP_ID`（テスト専用） |
| `useTraffic` | boolean? | 既定 true。false なら `TRAFFIC_UNAWARE`（Essentials SKU・安価） |
| `createdAt` | string | ISO8601 |
| `mapsApiKey` / `useOwnKey` | — | @deprecated。起動時に自動移行 |

### 5.2 Facility

`id` / `tenantId` / `name` / `postalCode` / `address` / `lat` / `lng` / `startPoint?` / `endPoint?` / `arriveBy`

`startPoint` / `endPoint` 未指定時は施設座標を使う。

### 5.3 Member

| フィールド | 型 | 既定 | 説明 |
|---|---|---|---|
| `id` / `name` | string | | **氏名は外部APIへ送信しない** |
| `postalCode` / `address` | string | | 住所は住所検索時のみ送信 |
| `lat` / `lng` | number | 施設座標 | 外部APIへ送るのはこれのみ |
| `pickupFrom` / `pickupTo` | string | 08:10 / 08:50 | お迎え希望時間帯 |
| `dropoffFrom` / `dropoffTo` | string | 16:00 / 16:45 | 復路用に保持（本版では未使用） |
| `boardingMinutes` | number | 3 | 乗車時間補正（停車時間） |
| `maxRideMinutes` | number? | 40 | 車内滞在の上限 |
| `requiresWheelchair` | boolean? | false | 車いす対応車両が必要か |
| `note` | string | "" | **外部APIへ送信しない**（要配慮情報が入りうる） |
| `active` | boolean | true | false は選択肢に出ない |

### 5.4 Vehicle

`id` / `name` / `capacity` / `wheelchair` / `active`

### 5.5 Stop

| フィールド | 説明 |
|---|---|
| `memberId` / `anonId` | 利用者ID／匿名ID（`利用者A`…。外部・ログ用） |
| `order` | 1始まりの巡回順 |
| `arriveMin` / `departMin` | 到着・出発予定（通算分） |
| `travelMin` / `staticTravelMin?` / `trafficDelayMin?` | 交通考慮／通常時／その差 |
| `distanceKm?` | 直前地点からの道路距離 |
| `estimated?` | **その区間が推定値で補完されたか** |
| `waitMin` / `lateMin` | 待機／遅れ |
| `rideMin?` | 車内滞在時間 |

### 5.6 RoutePlan

`vehicleId` / `departMin` / `stops` / `returnMin` / `lastLegMin` /
`totalTravelMin` / `staticTravelMin?` / `trafficDelayMin?` / `totalDistanceKm?` /
`encodedPolyline?` / `trafficIntervals?` / `departureTimeIso?` /
`routingPreference?`（`TRAFFIC_AWARE_OPTIMAL | TRAFFIC_AWARE | TRAFFIC_UNAWARE | DUMMY`）/
`estimatedLegCount?` / `recommendedDepartMin?` / `recommendedDepartReason?` /
**`latestDepartMin?`**（最遅出発可能時刻。不可なら null）/
`issues` / `travelSource` / `createdAt`

### 5.7 DayPlan / PlanSnapshot / RouteHistoryEntry

```ts
interface DayPlan {
  tenantId: string; facilityId: string;
  date: string;            // YYYY-MM-DD
  departTime: string;
  memberIds?: string[];
  snapshot?: PlanSnapshot; // 作成時点の設定の指紋（鮮度判定に使う）
  routes: RoutePlan[];
  createdAt: string;
}

interface PlanSnapshot {
  facility: string;                    // 施設の指紋
  departTime: string;
  members: Record<string, string>;     // memberId -> 指紋
  vehicles: Record<string, string>;    // vehicleId -> 指紋
}

interface RouteHistoryEntry {          // 過去ルート（軽量・最大30件）
  id: string; date: string; createdAt: string; departTime: string;
  memberIds: string[];
  orders: { vehicleId: string; memberIds: string[] }[];
  totalTravelMin: number; returnMin: number; hadError: boolean;
}
```

---

## 6. 永続化・マルチテナント・APIキー

### 6.1 保存キー

| キー | 内容 |
|---|---|
| `dayservice-route/tenants` | `{ tenants: Tenant[], currentId }` |
| `dayservice-route/t/<tenantId>` | 施設・利用者・車両・選択状態・DayPlan・履歴 |
| `dayservice-route/t/<tenantId>/before-import` | 取り込み直前の自動退避 |
| `dayservice-route/key/<tenantId>` | APIキー（既定 sessionStorage、明示選択時のみ localStorage） |

保存は `lib/storage.ts` の `activeStore: KeyValueStore` 経由。
**書き込み失敗は握りつぶさず** `saveStatus` に記録し、画面上部に赤帯で常時表示する
（LocalStorage は一般に数MB程度の容量制限があり、ブラウザ・環境によって異なる）。

### 6.2 テナント切替シーケンス

```
FacilitySettings で施設を選択
  ↓ switchTenant(tenantId, name)
  1. useTenantStore.setCurrentId()
  2. clearMatrixCache()
  3. persist.setOptions({ name: 保存キー })
  4. 保存データが無ければ resetEmpty()   ★分離の要（省くと前施設のデータが残る）
  5. persist.rehydrate()
  ↓ window.location.reload()（Maps JS のキーを読み直すため）
```

### 6.3 APIキーの方式と保管

```
resolveApiKey(envKey):
  keyMode='own'    → keyVault.getTenantKey(tenantId)   （課金主体＝その施設。本番の既定）
  keyMode='shared' → envKey                            （開発・デモ・体験利用のみ）
  keyMode='none'   → ''                                （デモモード）
```

**保管方針**：ブラウザ直結構成ではキーは必ず端末に露出する。したがって「隠す」のではなく
「盗まれても被害が有限」にする設計とする。

| 層 | 対策 | 防げる | 防げない |
|---|---|---|---|
| アプリ | 既定 `sessionStorage`（タブを閉じるまで） | 共有端末で次の利用者に渡ること | 盗み見そのもの |
| Google Cloud | HTTPリファラー制限 | 他サイトからの流用 | **サーバ／curlからの直接呼び出し（Referer詐称）** |
| Google Cloud | API制限（3つのみ） | 高額な別APIへの転用 | 許可APIの濫用 |
| Google Cloud | 割り当て上限・予算アラート | 青天井の請求 | 上限内の濫用 |

`sessionStorage` は**タブ単位**であり「ブラウザを閉じると消える」ではない。
別タブでは再入力が必要。攻撃耐性は `localStorage` と同等で、違うのは**残る期間**のみ。

### 6.4 バックアップ（書き出し・取り込み）

**書き出し（`exportJson`）**

- 含む：施設・利用者・車両・出発時刻の設定、`schemaVersion`、`exportedAt`、`_warning`
- **含まない**：APIキー（そもそも別保管）、`dayPlan`（一時データ・肥大化）、`history`（既定。オプションで含められる）
- 画面で件数つきの確認ダイアログを表示し、ファイル名から施設名を除く（`soso-backup-YYYY-MM-DD.json`）

**取り込み（`inspectJson` → `importJson`）**

| 検証 | 失敗時 |
|---|---|
| アプリ名 | `UNKNOWN_FORMAT` |
| `schemaVersion > 現行` | `FUTURE_VERSION`（既存データは無傷） |
| `tenantId` の不一致 | `TENANT_MISMATCH`（明示同意でのみ続行） |
| 必須項目・型（座標が数値／時刻が 00:00〜23:59／`boardingMinutes` が非負） | `INVALID_DATA`（項目名つき） |

取り込み前の状態は自動退避し、`undoImport()` で戻せる。現行スキーマは **v4**（v1〜v3も取り込み可）。

---

## 7. 外部API連携仕様

使用するのは**3つのみ**。他のAPI（Places, Route Optimization等）は使用しない。

### 7.1 Maps JavaScript API（地図表示・住所検索の実行基盤）

| 項目 | 内容 |
|---|---|
| 読み込み | `lib/mapsLoader.ts` に一元化。`<script>` 動的注入 → `importLibrary()` |
| パラメータ | `key, v=weekly, libraries=marker,geocoding, language=ja, region=JP, loading=async` |
| マーカー | `AdvancedMarkerElement`（Map ID 必須。既定は `DEMO_MAP_ID`＝テスト専用） |
| ラベル | 施設=`F`、停車=`①②③…`。**氏名は渡さない** |
| 認証失敗 | `window.gm_authFailure` → `MAPS_AUTH`（原因を断定せず候補を提示） |
| 失敗時 | SVG簡易マップへフォールバック＋注意カード |
| 描画条件 | **地点が2つ未満のときは地図を生成しない**（`fitBounds` の不安定化を回避） |

### 7.2 住所 → 座標（Geocoding）

**v0.4.2で経路を変更。** REST の Geocoding API はウェブサイト（HTTPリファラー）制限つきキーで
`REQUEST_DENIED` になるため、**Maps JavaScript API の Geocoder を第一経路**にした。

```
geocodeAddress(address):
  1. Maps JS を読み込み → google.maps.Geocoder().geocode({address, language:'ja', region:'JP'})
  2. 失敗（ZERO_RESULTS 以外）なら Geocoding API(REST) にフォールバック
  3. どちらの失敗も apiStatus に記録し、施設設定画面で原因を確認できる
```

- 送信するのは**住所文字列のみ**（氏名・備考・IDは送らない）
- 戻り値は `{lat, lng, formattedAddress, candidates[]}`。
  **候補が複数のときは先頭を黙って採用せず、画面でラジオ選択させる**
- 第一経路で完結する場合、Geocoding API の有効化は不要

### 7.3 Routes API — computeRouteMatrix（移動時間・距離）

| 項目 | 内容 |
|---|---|
| エンドポイント | `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix` |
| FieldMask | `originIndex,destinationIndex,duration,staticDuration,distanceMeters,condition` |
| 本文 | 全地点の座標、`travelMode:'DRIVE'`、`routingPreference`、`departureTime`（交通ON時のみ）、`languageCode:'ja'`、`units:'METRIC'` |
| 地点構成 | `[0]=出発地, [1..n]=利用者, [n+1]=帰着地` |
| 同一座標 | `isSameSpot()`（約20m以内）は **0分**として扱う（同居のご夫婦など） |
| 欠損 | `condition != ROUTE_EXISTS` の要素は推定値で補完し、`estimated[i][j]=true` を立てる |
| 上限 | `(n+2)^2 > 625` なら送信せず `TOO_MANY` |

### 7.4 Routes API — computeRoutes（ルート形状・渋滞）

| 項目 | 内容 |
|---|---|
| エンドポイント | `POST https://routes.googleapis.com/directions/v2:computeRoutes` |
| FieldMask | `routes.polyline.encodedPolyline, routes.distanceMeters, routes.duration, routes.staticDuration, routes.legs.*, routes.travelAdvisory.speedReadingIntervals` |
| 本文 | `origin` / `destination` / `intermediates`（確定済みの順）、`optimizeWaypointOrder:false`、`polylineQuality:'OVERVIEW'`、`extraComputations:['TRAFFIC_ON_POLYLINE']`（交通ON時） |
| 実行契機 | ルート作成後・並べ替え後に1回 |
| 失敗時 | 計画は保持し、地図は直線表示 |

### 7.5 送信情報の一覧

| データ | 保存 | Googleへ送信 |
|---|---|---|
| 氏名・備考・利用者ID | ブラウザ内 | **送信しない** |
| 住所 | ブラウザ内 | 住所検索の実行時のみ |
| 緯度・経度 | ブラウザ内 | 移動時間・ルート取得 |
| 地図ラベル | — | `F` と `①②③` のみ |

---

## 8. ルート最適化仕様

実装：`src/lib/routeEngine.ts`（副作用なしの純粋関数群）

### 8.1 公開API

```ts
buildOptimizedPlan(input, matrix): RoutePlan       // 自動最適化
planFromOrder(input, matrix, order): RoutePlan     // 指定順で再計算
searchBestOrder(input, matrix): number[]           // 多点スタート探索
recommendBestDepart(input, matrix, order)          // おすすめ出発時刻
suggestDepartMin(input, matrix, order)             // 最遅出発可能時刻
evaluateOrder(input, matrix, order)                // 評価値（テスト・調整用）
```

### 8.2 時刻シミュレーション

```
clock ← departMin ; prev ← 出発地
各 stop:
    travel ← matrix.minutes[prev][stop]
    arrive ← clock + travel
    wait   ← max(0, pickupFrom - arrive) ; arrive ← max(arrive, pickupFrom)
    late   ← max(0, arrive - pickupTo)
    depart ← arrive + boardingMinutes
    clock  ← depart ; prev ← stop
returnMin    ← clock + 最終区間
facilityLate ← max(0, returnMin - facilityArriveBy)
rideMin[i]   ← returnMin - stop[i].departMin        ← 施設到着後に確定
```

### 8.3 コスト関数

```
コスト = Σ 移動時間（交通考慮）
       + Σ 遅れ × 12
       + （遅れた人数）× 30
       + Σ 待機 × 0.6
       + 施設到着の遅れ × 8
       + Σ 車内滞在の超過分 × 3
```

| 重み | 値 | 意図 |
|---|---|---|
| `latePenalty` | 12 | 遅れ1分は移動12分に相当する不利益 |
| `lateFixedPenalty` | 30 | 総遅延が同じなら**遅れる人数が少ない案**を選ぶ |
| `waitPenalty` | 0.6 | 早着待機の軽い不利益 |
| `facilityLatePenalty` | 8 | 施設到着の遅れ |
| `rideOverPenalty` | 3 | 車内滞在が上限（既定40分）を超えた分 |
| `DEFAULT_MAX_RIDE_MIN` | 40分 | 利用者ごとに上書き可 |

**距離は評価に含めない。** 常に「その時刻に実際に何分かかるか」で判断する。

> 注：これらの重みは現時点で実測根拠を持たない暫定値である。
> v0.5.0でテナント設定（3段階プリセット）として外出しする予定。

### 8.4 探索

| 段階 | 内容 |
|---|---|
| 初期解（複数） | 12名以下は全員を1件目候補、13名以上は「締切が早い4名」 |
| 各初期解 | 最近傍法 → 2-opt（区間反転）→ or-opt（1件移動） |
| 停止 | 改善なし、または60ラウンド |
| 採用 | 全初期解のうちコスト最小 |

15名で実測数十ms（1秒以内をテストで固定）。

### 8.5 警告（RouteIssue）

| level | 条件 | title |
|---|---|---|
| error | `lateMin > 0` の停車あり | 時間制約を満たせません |
| error | `returnMin > facilityArriveBy` | 施設への到着が遅れます |
| warning | `rideMin > maxRideMinutes` | 車内での乗車時間が長くなります |
| warning | `waitMin ≥ 8` | 待ち時間が長い箇所があります |
| warning | `trafficDelayMin ≥ 5` | 渋滞の影響が見込まれます |
| info | 上記なし | すべての希望時間に間に合います |

### 8.6 出発時刻の2階建て

| 表示 | 実体 | 定義 |
|---|---|---|
| **おすすめ** | `recommendBestDepart()` | 全員間に合う案のうちコスト最小（待機も少ない）。同コストなら**現在の設定に最も近い時刻** |
| **最遅** | `suggestDepartMin()` | 全員間に合う中で最も遅い時刻。これを超えると条件を満たせない |

探索範囲は **現在の設定 −90分〜+60分**（1分刻み）。0時をまたがないよう下限をクランプする。
`reason` は `ok` / `earlier` / `later` / `impossible`。

---

## 9. 交通状況考慮仕様

### 9.1 出発時刻の解決

Routes API の `departureTime` は未来時刻でなければならない。

```
base = 今日の departTime
base > now + 60秒 → そのまま
それ以外           → base + 1日（翌日同時刻の予測。shiftedToNextDay = true）
```

### 9.2 routingPreference の選択

| 条件（`p = 利用者数 + 2`） | 設定 | 課金SKU |
|---|---|---|
| 施設設定で交通OFF | `TRAFFIC_UNAWARE` | Compute Routes **Essentials** |
| `p² ≤ 100`（利用者8名以下） | `TRAFFIC_AWARE_OPTIMAL` | Compute Routes **Pro** |
| それ以外 | `TRAFFIC_AWARE` | Compute Routes **Pro** |

### 9.3 リクエスト上限

`p² > 625`（利用者24名超）は送信せず `TOO_MANY`。便を分けるよう案内する。

### 9.4 通常時と交通考慮

`duration`（交通考慮）と `staticDuration`（通常時）を同時取得し、差を `trafficDelayMin` として
区間・全体の両方で表示する。デモモードでは両者を同値とする（増加0分）。

### 9.5 渋滞の可視化

`speedReadingIntervals` を `TrafficInterval[]` に変換し、復号済みポリラインを区間ごとに色分けする。

| speed | 色 | 表示 |
|---|---|---|
| `NORMAL` | `#2f6f4e` | 順調 |
| `SLOW` | `#e8a33d` | やや混雑 |
| `TRAFFIC_JAM` | `#c0392b` | 渋滞 |

### 9.6 キャッシュ

```
key = [start, end, members[{id,lat,lng}], floor(departMin / 15), useTraffic]
```

並べ替えや±5分の調整では再取得しない。座標変更時は `clearMatrixCache()` を明示呼び出し。

---

## 10. 整合性管理（送迎表の鮮度）

実装：`src/lib/freshness.ts`

### 10.1 考え方

利用者の削除・無効化・住所変更・希望時間変更・車両設定変更・出発時刻変更・日付またぎは、
すべて「**作成済みの送迎表が現状と食い違う**」という同じ事故に帰着する。
個別フラグは立て忘れが必ず起きるため、**作成時の指紋（`PlanSnapshot`）と現在の設定を
突き合わせる派生値**として実装する。

### 10.2 状態

| 状態 | 条件 | 画面の扱い |
|---|---|---|
| `READY` | 一致 | 通常表示 |
| `STALE` | 当日だが作成後に設定が変わった | 琥珀の警告＋変更理由の一覧＋「作り直す」導線。**印刷物にも不一致を印字** |
| `OUTDATED` | 別の日に作られた | 赤の警告。ダッシュボードでは当日ぶんとして扱わない |

### 10.3 指紋の対象

| 対象 | 含める項目 |
|---|---|
| 利用者 | 氏名・座標・希望時間・乗車時間補正・車内時間上限・車いす・有効/無効 |
| 車両 | 名称・定員・車いす対応・稼働 |
| 施設 | 名称・座標・到着希望時刻 |
| 全体 | 出発時刻・作成日 |

### 10.4 利用者が削除されている場合（特別扱い）

住所も希望時間も失われており、**再計算も地図描画も不可能**。
ルート結果画面は通常表示を行わず、専用画面に切り替える。

- 「⚠ この送迎表は作り直しが必要です」＋削除された人数
- 「本日お休みなだけなら**無効にする**を使ってください」という案内
- 「ルートを作り直す」／「この送迎表を破棄する」

（v0.4.0ではここで `undefined` 参照によりクラッシュ、v0.4.1では描画継続によりフリーズしていた）

---

## 11. 画面仕様

### 11.1 画面遷移

```
ダッシュボード / ─┬→ 送迎ルート作成 /create ─→ ルート結果 /result
                  ├→ 利用者管理 /members
                  └→ 施設設定 /facility        （5画面すべて上部タブから直接遷移可）
```

`HashRouter`。未定義パスは `/` へリダイレクト。

### 11.2 共通レイアウト

| 要素 | 内容 |
|---|---|
| **保存失敗の赤帯** | 一度失敗したら消えない。バックアップを促す |
| タイトル | 「送迎ルート作成」＋本日の日付 |
| テナントチップ | 現在の施設名 |
| 状態バッジ | `デモモード（APIキー未設定）` / `Google Maps 連携済み` / `⚠ 接続エラー → デモモードで継続` |
| タブナビ | 5画面 |
| 印刷時 | `.no-print` を非表示 |

### 11.3 ダッシュボード

- 施設名・日付、集計3枚（今日の利用者数／登録利用者数／出発予定＋おすすめ時刻）
- 「今日の送迎」：`OUTDATED` の場合は当日ぶんとして表示せず作成を促す。`STALE` は警告表示
- 「ルートを作成する」大ボタン

### 11.4 送迎ルート作成（3ステップ）

| ステップ | 仕様 |
|---|---|
| ① 利用者を選ぶ | `active` のみ表示。カード型チェック。全員選択／全解除 |
| ② 出発時刻 | `<input type="time">`。「この時刻の交通状況を考慮します」 |
| （車両） | 定員超過・車いす非対応を `checkVehicleFit()` で事前警告 |
| （前回ルート） | 同じ顔ぶれの履歴があれば「前回と同じ順番で作る」。**休みの人は除き、新規は末尾に追加**して適用し、結果画面で内容を通知 |
| ③ 実行 | 実行中は「交通状況を考慮して計算中…」で `disabled` |

### 11.5 ルート結果

| ブロック | 内容 | 印刷 |
|---|---|---|
| お知らせ | 前回順の適用結果など | 非表示 |
| **鮮度の警告** | `STALE` / `OUTDATED` の理由と作り直し導線 | 非表示（内容は印刷ヘッダに反映） |
| **出発時刻パネル** | 現在の設定／**おすすめ**／**最遅**／判定（n分早めてください等）＋ワンクリック適用。遅れる人数・渋滞増加・施設到着を併記 | 非表示 |
| 前回比較 | 順番の異同・移動時間の増減・施設到着の差。前回順に戻せる | 非表示 |
| 車両タブ | `routes.length > 1` のときのみ | 非表示 |
| 移動時間の内訳 | 通常時／現在予測／交通による増加。出所と総走行距離 | 非表示 |
| 操作バー | 出発時刻、±5分、出所、印刷 | 非表示 |
| 地図 | 凡例つき。エラー時は簡易マップ＋注意 | 非表示 |
| ルート一覧 | ドラッグ＆ドロップ＋▲▼。**計算中は並べ替え不可**。遅れは赤枠。推定値区間・無効/削除済みバッジ | 非表示 |
| **送迎表** | 順／利用者／到着予定／乗車／備考。ヘッダに日付・施設・車両・**データ出所**・鮮度警告 | **印刷対象** |

**印刷物に必ず印字するデータ出所**

- デモモード → `⚠ デモモード：移動時間は推定値です`
- 一部欠損 → `⚠ 一部区間（n区間）に推定値を使用しています`
- 正常 → `移動時間：Google Maps の実データ（交通状況考慮）`

`@page { size: A4 portrait; margin: 14mm }`

### 11.6 利用者管理

- 一覧：氏名・住所・希望時間・乗車補正・車いすバッジ・無効バッジ
- 操作：有効/無効の切替、編集、削除
- **削除の確認**：本日のルートに含まれる場合はその旨を明示し、
  いずれの場合も「本日お休みなだけであれば**無効にする**をお使いください」と案内
- 編集：氏名／郵便番号／住所（＋住所から座標）／緯度／経度／お迎え・お送り希望／
  乗車時間補正／車内時間上限／車いす／有効無効／備考
- **住所検索**：候補が複数ならラジオで選択。失敗時は日本語の原因と対処
- 保存時に `clearMatrixCache()`

### 11.7 施設設定

| セクション | 内容 |
|---|---|
| 施設の切替 | 選択・追加・削除、テナント名、保存キーの表示 |
| 施設情報 | 名称／郵便番号／住所／緯度／経度／到着希望時刻 |
| Google Maps 連携 | 状態、使用API、直近成功、直近エラー（技術的な詳細つき） |
| この施設のAPIキー | 方式3択、キー入力（マスク表示・削除）、保存場所、**交通状況ON/OFF**、Map ID |
| データの管理 | 共有端末の運用注意、書き出し（確認つき）／取り込み（検証つき）／取り消し／端末データ削除（施設名入力の二段階）／サンプル復帰 |

### 11.8 デザイン規約

| 項目 | 規約 |
|---|---|
| 背景 | `#f7f8f7`（`pageBg`） |
| 文字 | `#1f2933`。本文 `text-lg` 以上、数値は `text-3xl`〜`text-5xl` |
| アクセント | `#2f6f4e` ／ 淡色 `#e6f0ea` |
| 警告 | `#c0392b` ＋ `#fdecea`。**赤は警告と削除のみ** |
| 中間の注意 | 琥珀（`amber-50` / `amber-400`） |
| ボタン | 枠線2px。既定 `px-6 py-4 text-lg`。**無効時は opacity 40%＋カーソル変化**で明確に区別 |
| タッチ | ホバーに依存せず `active:` の背景変化で押下を返す |
| カード | 白・角丸2xl・薄いボーダー・`p-6` |

---

## 12. 状態管理仕様

### 12.1 useAppStore（テナント単位で永続化・version 3）

`facility` / `members` / `vehicles` / `selectedIds` / `departTime` / `vehicleId` /
`dayPlan` / `activeRouteIndex` / `manualOrder` / `history` / `notice`

| action | 副作用 |
|---|---|
| `setDepartTime` | `clearMatrixCache()` |
| `setDayPlan` | `activeRouteIndex` を0に |
| `updateActiveRoute` | 表示中の車両のルートのみ差し替え |
| `pushHistory` | 履歴に積む（最大30件） |
| `findPreviousFor` | 同じ利用者構成の直近履歴 |
| `replaceAll` / `resetToSample` / `resetEmpty` | 全state置換 |

モジュール関数：`switchTenant` / `exportCurrentTenant` / `inspectBackup` /
`importCurrentTenant` / `undoImport` / `wipeCurrentTenant`

### 12.2 useTenantStore

`tenants` / `currentId` を保持し、変更のたびに即時保存。
`removeTenant` は業務データとAPIキーも削除する。

### 12.3 useApiStatus / useSaveStatus（非永続）

- `useApiStatus`：`mode`（demo / google / fallback）、`lastError`、`lastSuccess`
- `useSaveStatus`：`failed`、`message`、`detail`。一度失敗したら自動では消さない

---

## 13. エラー処理仕様

### 13.1 エラーコード

| code | 画面メッセージ |
|---|---|
| `NO_KEY` | Google Maps のAPIキーが設定されていません |
| `INVALID_KEY` | APIキーが正しくありません |
| `API_NOT_ENABLED` | このAPIがGoogle Cloudで有効になっていません |
| `REFERER_BLOCKED` | APIキーの利用制限でブロックされました |
| `REFERER_UNSUPPORTED` | このAPIはウェブサイト制限つきのキーでは利用できません |
| `MAPS_AUTH` | 地図の認証に失敗しました（原因候補を併記） |
| `QUOTA` | Google Maps の利用上限に達しました |
| `NOT_FOUND` | 住所が見つかりませんでした |
| `NO_ROUTE` | 道路のルートを取得できませんでした |
| `TOO_MANY` | 一度に計算できる人数を超えています |
| `NETWORK` | ネットワークに接続できませんでした |
| `UNKNOWN` | Google Maps との通信に失敗しました |

各コードは `message`（何が起きたか）と `hint`（どうすればよいか）を必ず持つ。

### 13.2 判定の要点

- REST：429/`RESOURCE_EXHAUSTED`→QUOTA、`api key not valid`→INVALID_KEY、
  `has not been used in project`→API_NOT_ENABLED、`referer`→REFERER_BLOCKED、
  403→API_NOT_ENABLED、400→INVALID_KEY
- Geocoding `REQUEST_DENIED`：**`referer` を含む場合は `REFERER_UNSUPPORTED`**
  （「API key」の文字列だけで無効キーと誤判定しない）
- `gm_authFailure`：原因を区別できないため `MAPS_AUTH`（断定しない）
- 例外：`failed to fetch` 等→NETWORK

### 13.3 フォールバック

| 失敗箇所 | 動作 |
|---|---|
| computeRouteMatrix | 推定値で計算続行。`travelSource='dummy'`、バッジは fallback |
| computeRoutes | 計画は保持、地図は直線 |
| Maps JavaScript API | 簡易マップ＋注意カード |
| 住所検索（JS経路） | REST へフォールバック。両方失敗なら原因を表示 |
| 一部区間のみ | 推定値で補完し、`estimated` を立てて**画面と印刷物に明示** |
| 保存 | 赤帯で通知（アプリは継続） |

**いかなる失敗でもアプリはクラッシュせず、ルート作成は必ず完了する。**

---

## 14. 非機能要件

| 分類 | 要件 | 実現方法 |
|---|---|---|
| 性能 | 利用者20名で3秒以内 | マトリクス1回＋形状1回。最適化はローカル |
| API課金 | 並べ替えで課金を増やさない | 15分バケットのキャッシュ、FieldMask最小化、交通OFF選択肢 |
| 可用性 | オフラインでも業務継続 | デモモードとフォールバック |
| 対応環境 | PC / タブレット、主要3ブラウザの最新2版 | `sm:` ブレークポイント中心 |
| 操作性 | 3ステップでルート作成 | 選択→時刻→作成 |
| 可読性 | 高齢者施設で業務中に使用 | 本文18px以上、ボタン高さ56px前後、2px枠、無効状態の明示 |
| 信頼性の可視化 | 結果の出所を職員が判断できる | 推定値・鮮度・デモモードを画面と印刷物に明示 |
| 印刷 | A4縦1枚 | `@page` と `.no-print` / `.print-only` |
| セキュリティ | キーをリポジトリに含めない | `.env` を `.gitignore`、コード内に直書きなし |
| 個人情報 | 氏名を外部へ出さない | 外部通信3ファイルに集約、地図ラベルは記号のみ |
| データ分離 | 施設間で混ざらない | 保存キー分離＋切替時の明示的初期化＋取り込み時のテナント照合 |

---

## 15. ビルド・実行仕様

### 15.1 環境変数

| 変数 | 用途 |
|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | **開発・デモ用の共通キー**（任意）。実運用は施設ごとに画面から設定 |

`.env` は起動時のみ読み込まれる。`.env.example` の雛形文字列（`ここにAPIキー` 等）は未設定として扱う。

### 15.2 コマンド

| コマンド | 内容 |
|---|---|
| `npm install` | 依存の取得 |
| `npm run dev` | 開発サーバ（`http://localhost:5173`） |
| `npm run build` | `tsc -b` → `vite build` → `dist/` |
| `npm run preview` | ビルド結果の確認 |
| `npm test` | シナリオテスト83件 |

`tailwind.config.js` など設定ファイルを変更した場合は dev サーバの再起動が必要。

---

## 16. テスト

`npm test`（vitest, **83件**）。実APIは呼ばず、移動時間マトリクスをテスト側から与えるため完全に再現可能。
`src/lib/__tests__/setup.ts` が Node 上に `localStorage` / `sessionStorage` のメモリ実装を用意する。

| ファイル | 件数 | 内容 |
|---|---|---|
| `routeEngine.test.ts` | 27 | 基本／希望時間／間に合わない／交通／車内滞在／出発時刻提案／並べ替え／規模／個人情報 |
| `infra.test.ts` | 26 | プロバイダ／住所検索とエラー分類／ポリライン・時刻／車両割当／キー保管／保存層 |
| `safety.test.ts` | 30 | v0.4.1受け入れ（同一座標・推定値・誤判定・バックアップ検証・保存失敗・鮮度・前回順・並べ替えガード） |

### 16.1 受け入れ条件（v0.4.1で固定した項目）

| ID | 内容 |
|---|---|
| T-01 | 同一座標は移動0分 |
| T-07 | 一部推定値の検出と件数 |
| T-11 | `gm_authFailure` を原因断定しない |
| T-11b | リファラー制限つきキーの拒否を無効キーと誤判定しない |
| T-12 | 住所検索の複数候補 |
| T-14 | 書き出しJSONにAPIキーが含まれない／`dayPlan`・履歴を含めない |
| T-15〜T-18 | 旧版取り込み／未知版拒否／別施設拒否／壊れたデータの項目名つき拒否／取り消し |
| T-19 | 保存失敗の通知 |
| T-22〜T-23 | 削除・無効化の検知（＋住所・車両・施設・出発時刻・日付） |
| T-24 | 前回順の適用（休みを除き、新規を追加） |
| T-30 | 計算中の並べ替えを無視 |

### 16.2 未実装のテスト観点

同時刻の同一希望、2タブ同時編集、印刷中の再計算、履歴30件超、リロード後の再計算課金、
オフライン切り替わりの統合テスト。詳細は `docs/REVIEW-2.md` 6章。

---

## 17. 運用ガイド（施設向けの前提）

| 項目 | 推奨 |
|---|---|
| Google Cloud | 施設ごとにプロジェクトを作成し、3つのAPIのみ有効化 |
| APIキー | ウェブサイト制限＋API制限を必須。**割り当て上限と予算アラート**で金額被害を有限化 |
| 端末 | 施設の業務端末は通常ウィンドウ（データを保存）。端末にPIN/パスワードロック、職員別OSユーザー |
| 借用端末 | 使用後に「この端末のデータを削除」。シークレットウィンドウは**日常業務には不向き**（利用者登録も消えるため） |
| バックアップ | 定期的に書き出し。ファイルは個人情報を含むため、持ち出し・共有に注意 |
| 休みの利用者 | **削除ではなく「無効にする」**。登録が残り、送迎表も壊れない |

---

## 18. 既知の制限と今後

### 18.1 既知の制限

1. 復路（お送り）は未実装（データ項目のみ保持）
2. 複数車両は入れ物・画面・単純割当まで。地理クラスタリング等は未実装
3. テナント分離はブラウザ内保存のため、端末をまたぐSaaSにはサーバ認証とRLSが必要
4. APIキーはリファラー制限で守る方式（完全秘匿にはサーバ経由が必要）
5. デモモードの移動時間は直線距離ベースの推定
6. 出発時刻を過ぎている場合は翌日同時刻の交通予測（曜日差は反映されない）
7. 利用者24名超は1リクエストで計算できない
8. コスト関数の重みは暫定値で、実測根拠がない

### 18.2 今後（想定）

| 版 | テーマ | 主な内容 |
|---|---|---|
| v0.5.0 | 施設ごとの運用に合わせられる | 重みのプリセット化、安全マージン設定、車内時間の分布表示、複数車両の実用化 |
| SaaS版 | 複数職員・複数施設で安全に運用できる | 認証とロール、サーバ側テナント分離（RLS）、APIキーのサーバ保管（BFF）、監査ログ、同時編集の競合解決 |

---

## 付録A. 主要定数

| 定数 | 場所 | 値 |
|---|---|---|
| `WEIGHTS.latePenalty` | routeEngine.ts | 12 |
| `WEIGHTS.lateFixedPenalty` | routeEngine.ts | 30 |
| `WEIGHTS.waitPenalty` | routeEngine.ts | 0.6 |
| `WEIGHTS.facilityLatePenalty` | routeEngine.ts | 8 |
| `WEIGHTS.rideOverPenalty` | routeEngine.ts | 3 |
| `DEFAULT_MAX_RIDE_MIN` | routeEngine.ts | 40分 |
| 2-opt/or-opt の最大ラウンド | routeEngine.ts | 60 |
| おすすめ出発時刻の探索幅 | routeEngine.ts | −90〜+60分（1分刻み） |
| 最遅出発時刻の探索幅 | routeEngine.ts | 0〜120分（1分刻み） |
| 待機警告 / 渋滞警告のしきい値 | routeEngine.ts | 8分 / 5分 |
| `AVG_KMH` / `DETOUR` / `FIXED` | geo.ts | 22km/h / 1.3 / 1.5分 |
| 同一地点とみなす距離 | geo.ts | 20m |
| マトリクスのキャッシュ粒度 | planner.ts | 15分 |
| `TRAFFIC_AWARE_OPTIMAL` / `TRAFFIC_AWARE` 上限 | travelProvider.ts | 100 / 625要素 |
| `MIN_AHEAD_MS` | travelProvider.ts | 60秒 |
| 履歴の保持件数 | useAppStore.ts | 30件 |
| バックアップのスキーマ版 | repository.ts | 4 |

## 付録B. 関連ドキュメント

- `README.md` … 起動方法・ファイル役割・設計方針の概要
- `GOOGLE_MAPS_SETUP.md` … Google Cloud 側の設定手順（初心者向け）
- `CHANGELOG.md` … 版ごとの変更履歴
- `docs/REVIEW.md` … v0.4.0 設計レビュー
- `docs/REVIEW-2.md` … 現場運用の穴のレビューと3段階の優先度
