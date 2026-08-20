import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { recalcPlan, recommendDepart, reorderIfAllowed } from '../lib/planner';
import { planFreshness } from '../lib/freshness';
import HelpLink from '../components/HelpLink';
import { HELP_ANCHORS } from '../lib/helpContent';
import { toHHMM, todayLabel } from '../lib/time';
import MapView, { circledNumber, type MapPoint } from '../components/MapView';
import { useApiStatus } from '../lib/apiStatus';

export default function RouteResult() {
  const {
    facility, members, vehicles, dayPlan, departTime, setDepartTime, vehicleId,
    updateActiveRoute, activeRouteIndex, setActiveRouteIndex, manualOrder, setManualOrder,
    findPreviousFor, notice, setNotice, setDayPlan,
  } = useAppStore();
  const plan = dayPlan?.routes[activeRouteIndex] ?? null;
  const setPlan = updateActiveRoute;
  const [busy, setBusy] = useState(false);
  const dragIdx = useRef<number | null>(null);
  const { mode, lastError } = useApiStatus();

  // 削除された利用者が混ざっていても落ちないように、必ず存在チェックを通す
  const chosen = useMemo(
    () =>
      plan
        ? plan.stops
            .map((s) => members.find((m) => m.id === s.memberId))
            .filter((m): m is NonNullable<typeof m> => !!m)
        : [],
    [plan, members]
  );
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? '不明';
  const memberOf = (id: string) => members.find((m) => m.id === id);

  if (!plan || plan.stops.length === 0) {
    return (
      <div className="card text-center space-y-4">
        <p className="text-xl">まだルートが作成されていません。</p>
        <Link to="/create" className="btn-primary">ルートを作成する</Link>
      </div>
    );
  }

  // 送迎表に含まれる利用者が削除されている場合、そのまま描画すると
  // 地図・並べ替え・再計算がすべて不整合になる。表示せず作り直しを促す。
  const missing = plan.stops.filter((s) => !members.some((m) => m.id === s.memberId));
  if (missing.length > 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border-2 border-warn bg-warnSoft p-6">
          <p className="text-2xl font-bold text-warn">⚠ この送迎表は作り直しが必要です</p>
          <p className="text-lg mt-2">
            送迎表に含まれる利用者 {missing.length}名 が登録から削除されています。
            住所や希望時間が分からないため、到着時刻を正しく計算できません。
          </p>
          <p className="text-lg mt-2 text-gray-700">
            本日お休みなだけであれば、利用者管理で「無効にする」をお使いください
            （登録は残るので、翌日以降そのまま使えます）。
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            <Link to="/create" className="btn-primary">ルートを作り直す</Link>
            <button className="btn-sub" onClick={() => { setDayPlan(null); setManualOrder(null); }}>
              この送迎表を破棄する
            </button>
          </div>
        </div>
      </div>
    );
  }

  const order = manualOrder ?? plan.stops.map((s) => s.memberId);

  const applyOrder = async (ids: string[]) => {
    setBusy(true);
    try {
      setManualOrder(ids);
      const next = await recalcPlan(facility, chosen, toHHMM(plan.departMin), vehicleId, ids);
      setPlan(next);
    } finally { setBusy(false); }
  };

  // 計算中の並べ替えは無視する（再計算結果の上書き事故を防ぐ）
  const move = (from: number, to: number) => {
    const next = reorderIfAllowed(busy, order, from, to);
    if (next) applyOrder(next);
  };

  const shiftDepart = async (min: number) => {
    const t = toHHMM(plan.departMin + min);
    setDepartTime(t);
    setBusy(true);
    try {
      const next = await recalcPlan(facility, chosen, t, vehicleId, order);
      setPlan(next);
    } finally { setBusy(false); }
  };

  const autoFixDepart = async () => {
    setBusy(true);
    try {
      const rec = await recommendDepart(facility, chosen, toHHMM(plan.departMin), vehicleId, order);
      if (rec == null) { alert('出発時刻の調整だけでは全員の希望時間を満たせません。順番の変更や別車両をご検討ください。'); return; }
      const t = toHHMM(rec);
      setDepartTime(t);
      const next = await recalcPlan(facility, chosen, t, vehicleId, order);
      setPlan(next);
    } finally { setBusy(false); }
  };

  // 地図へ渡すのは記号と座標のみ（利用者名は渡さない）
  const mapPoints: MapPoint[] = useMemo(() => [
    { lat: facility.lat, lng: facility.lng, label: 'F', kind: 'facility' },
    ...plan.stops.flatMap<MapPoint>((s, i) => {
      const m = memberOf(s.memberId);
      return m ? [{ lat: m.lat, lng: m.lng, label: circledNumber(i + 1), kind: 'stop' }] : [];
    }),
  ], [facility.lat, facility.lng, plan.stops, members]);

  const hasError = plan.issues.some((i) => i.level === 'error');

  const recMin = plan.recommendedDepartMin ?? plan.departMin;
  const recReason = plan.recommendedDepartReason ?? 'ok';
  const diff = plan.departMin - recMin; // 正なら「早める」必要がある
  const lateCount = plan.stops.filter((s) => s.lateMin > 0).length;

  const applyRecommended = async () => {
    if (recReason === 'impossible' || diff === 0) return;
    const t = toHHMM(recMin);
    setDepartTime(t);
    setBusy(true);
    try {
      const next = await recalcPlan(facility, chosen, t, vehicleId, order);
      setPlan(next);
    } finally { setBusy(false); }
  };

  const prev = findPreviousFor(plan.stops.map((s) => s.memberId));
  const prevSameOrder =
    prev &&
    prev.orders.some(
      (o) => o.memberIds.join(',') === plan.stops.map((s) => s.memberId).join(',')
    );

  const fresh = planFreshness(dayPlan, { facility, members, vehicles, departTime });
  const sourceLabel =
    plan.travelSource === 'google'
      ? (plan.estimatedLegCount ?? 0) > 0
        ? `Google実データ（うち${plan.estimatedLegCount}区間は推定値）`
        : 'Google実データ'
      : 'デモモード：推定値';

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-2xl border-2 border-accent bg-accentSoft p-4 no-print flex items-start gap-3">
          <p className="text-lg flex-1">✓ {notice}</p>
          <button className="btn-sub btn-sm" onClick={() => setNotice(null)}>閉じる</button>
        </div>
      )}

      {/* ★この送迎表は現在の設定と一致しているか */}
      {fresh.status !== 'READY' && (
        <div className={
          'rounded-2xl border-2 p-5 no-print ' +
          (fresh.status === 'OUTDATED' ? 'border-warn bg-warnSoft' : 'border-amber-400 bg-amber-50')
        }>
          <p className="text-xl font-bold text-warn">
            {fresh.status === 'OUTDATED'
              ? '⚠ これは本日の送迎表ではありません'
              : '⚠ この送迎表は現在の利用者情報と一致していません'}
          </p>
          <ul className="list-disc pl-6 mt-2 text-lg space-y-1">
            {fresh.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <p className="mt-2 text-gray-700">印刷・配布の前に、送迎表を作り直してください。</p>
          <Link to="/create" className="btn-primary btn-sm mt-3">ルートを作り直す</Link>
        </div>
      )}

      {/* ★今日は何時に出ればよいか（最優先の情報） */}
      <div className={
        'rounded-2xl border-2 p-6 no-print ' +
        (recReason === 'impossible'
          ? 'border-warn bg-warnSoft'
          : recReason === 'ok'
          ? 'border-accent bg-accentSoft'
          : 'border-amber-400 bg-amber-50')
      }>
        <div className="flex flex-wrap items-center gap-3 mb-3 sm:mb-4">
          <h2 className="text-xl sm:text-2xl font-bold">今日は何時に出発すればよいか</h2>
          <div className="ml-auto"><HelpLink anchor={HELP_ANCHORS.routeResult} /></div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 items-stretch">
          <div className="rounded-2xl bg-white border border-gray-200 p-4 text-center">
            <p className="text-gray-500 text-lg">現在の設定</p>
            <p className="text-3xl sm:text-4xl font-bold mt-1">{toHHMM(plan.departMin)}</p>
          </div>
          <div className="rounded-2xl bg-white border-2 border-accent p-4 text-center">
            <p className="text-gray-600 text-lg">おすすめ</p>
            <p className="text-4xl font-bold mt-1 text-accent">
              {recReason === 'impossible' ? '—' : toHHMM(recMin)}
            </p>
            <p className="text-gray-500 text-sm mt-1">余裕をもって回れる時刻</p>
          </div>
          <div className="rounded-2xl bg-white border border-gray-300 p-4 text-center">
            <p className="text-gray-600 text-lg">最遅</p>
            <p className="text-4xl font-bold mt-1">
              {plan.latestDepartMin != null ? toHHMM(plan.latestDepartMin) : '—'}
            </p>
            <p className="text-gray-500 text-sm mt-1">
              {plan.latestDepartMin != null ? 'これより遅いと間に合いません' : '時刻調整では間に合いません'}
            </p>
          </div>
          <div className="rounded-2xl bg-white border border-gray-200 p-4 text-center flex flex-col justify-center">
            {recReason === 'ok' && <p className="text-2xl font-bold text-accent">今の時刻でOK</p>}
            {recReason === 'earlier' && (
              <p className="text-2xl font-bold text-warn">{diff}分 早めてください</p>
            )}
            {recReason === 'later' && (
              <p className="text-2xl font-bold">{-diff}分 遅らせても間に合います</p>
            )}
            {recReason === 'impossible' && (
              <p className="text-xl font-bold text-warn">時刻の調整だけでは<br />間に合いません</p>
            )}
            {recReason !== 'ok' && recReason !== 'impossible' && (
              <button className="btn-primary btn-sm mt-3" onClick={applyRecommended} disabled={busy}>
                おすすめに合わせる
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-lg">
          <span className={lateCount > 0 ? 'text-warn font-bold' : ''}>
            {lateCount > 0 ? `⚠ 希望時間に間に合わない方 ${lateCount}名` : '✓ 全員が希望時間内'}
          </span>
          <span className={(plan.trafficDelayMin ?? 0) > 0 ? 'text-warn' : ''}>
            渋滞による増加 {(plan.trafficDelayMin ?? 0) > 0 ? `＋${plan.trafficDelayMin}分` : 'なし'}
          </span>
          <span>施設到着予定 {toHHMM(plan.returnMin)}（希望 {facility.arriveBy}）</span>
        </div>
      </div>

      {/* 前回ルートとの比較 */}
      {prev && (
        <div className="card no-print">
          <h3 className="text-xl font-bold mb-2">前回（{prev.date} {prev.departTime}出発）との比較</h3>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-lg">
            <span>順番：{prevSameOrder ? '前回と同じ' : '前回と異なる'}</span>
            <span>
              移動時間：前回 {prev.totalTravelMin}分 → 今回 {plan.totalTravelMin}分
              {plan.totalTravelMin !== prev.totalTravelMin && (
                <strong className={plan.totalTravelMin < prev.totalTravelMin ? ' text-accent' : ' text-warn'}>
                  （{plan.totalTravelMin < prev.totalTravelMin ? '−' : '＋'}
                  {Math.abs(plan.totalTravelMin - prev.totalTravelMin)}分）
                </strong>
              )}
            </span>
            <span>施設到着：前回 {toHHMM(prev.returnMin)} → 今回 {toHHMM(plan.returnMin)}</span>
          </div>
          {!prevSameOrder && (
            <button className="btn-sub btn-sm mt-3" disabled={busy}
              onClick={() => {
                const o = prev.orders.find((x) => x.vehicleId === plan.vehicleId) ?? prev.orders[0];
                applyOrder(o.memberIds.filter((id) => plan.stops.some((s) => s.memberId === id)));
              }}>
              前回と同じ順番に戻す
            </button>
          )}
        </div>
      )}

      {/* 警告 */}
      <div className="no-print space-y-3">
        {plan.issues.map((iss, i) => (
          <div key={i}
            className={
              'rounded-2xl border p-5 ' +
              (iss.level === 'error'
                ? 'border-warn bg-warnSoft'
                : iss.level === 'warning'
                ? 'border-amber-300 bg-amber-50'
                : 'border-accent bg-accentSoft')
            }>
            <p className={'text-xl font-bold ' + (iss.level === 'error' ? 'text-warn' : '')}>
              {iss.level === 'error' ? '⚠ ' : iss.level === 'warning' ? '△ ' : '✓ '}{iss.title}
            </p>
            <p className="mt-2 whitespace-pre-line text-lg">{iss.detail}</p>
            {iss.suggestions.length > 0 && (
              <ul className="mt-3 list-disc pl-6 text-lg space-y-1">
                {iss.suggestions.map((s, j) => <li key={j}>{s}</li>)}
              </ul>
            )}
          </div>
        ))}
        {hasError && (
          <button className="btn-primary" onClick={autoFixDepart} disabled={busy}>
            間に合う出発時刻に自動調整する
          </button>
        )}
      </div>

      {/* 車両タブ（複数車両になったときだけ表示） */}
      {(dayPlan?.routes.length ?? 0) > 1 && (
        <div className="card no-print flex flex-wrap gap-2">
          {dayPlan!.routes.map((r, i) => (
            <button key={r.vehicleId}
              onClick={() => { setActiveRouteIndex(i); setManualOrder(r.stops.map((x) => x.memberId)); }}
              className={
                'rounded-xl px-5 py-3 text-lg font-bold border ' +
                (i === activeRouteIndex
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white text-ink border-gray-300 hover:bg-gray-50')
              }>
              {vehicles.find((v) => v.id === r.vehicleId)?.name ?? '車両'}（{r.stops.length}名）
            </button>
          ))}
        </div>
      )}

      {/* 交通状況のサマリ */}
      <div className="card no-print">
        <h3 className="text-2xl font-bold mb-3">移動時間の内訳</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="rounded-2xl border border-gray-200 p-4 text-center">
            <p className="text-gray-500 text-lg">通常時</p>
            <p className="text-4xl font-bold mt-1">{plan.staticTravelMin ?? plan.totalTravelMin}<span className="text-xl">分</span></p>
          </div>
          <div className="rounded-2xl border-2 border-accent bg-accentSoft p-4 text-center">
            <p className="text-gray-600 text-lg">現在予測（交通考慮）</p>
            <p className="text-4xl font-bold mt-1 text-accent">{plan.totalTravelMin}<span className="text-xl">分</span></p>
          </div>
          <div className={
            'rounded-2xl border p-4 text-center ' +
            ((plan.trafficDelayMin ?? 0) > 0 ? 'border-warn bg-warnSoft' : 'border-gray-200')
          }>
            <p className="text-gray-500 text-lg">交通による増加</p>
            <p className={'text-4xl font-bold mt-1 ' + ((plan.trafficDelayMin ?? 0) > 0 ? 'text-warn' : '')}>
              {(plan.trafficDelayMin ?? 0) > 0 ? '＋' : '±'}{plan.trafficDelayMin ?? 0}<span className="text-xl">分</span>
            </p>
            {(plan.trafficDelayMin ?? 0) > 0 && <p className="text-warn">（渋滞）</p>}
          </div>
        </div>
        <p className="text-gray-500 mt-3">
          {plan.travelSource === 'google'
            ? `出発時刻 ${toHHMM(plan.departMin)} の交通状況で計算（${plan.routingPreference}）`
            : 'デモモードのため推定値です。APIキーを設定すると実際の交通状況が反映されます。'}
          {plan.totalDistanceKm ? `／総走行 ${plan.totalDistanceKm}km` : ''}
        </p>
      </div>

      {/* 操作 */}
      <div className="card no-print flex flex-wrap items-center gap-3">
        <span className="text-lg font-bold">出発時刻</span>
        <span className="text-3xl font-bold">{toHHMM(plan.departMin)}</span>
        <button className="btn-sub btn-sm" onClick={() => shiftDepart(-5)} disabled={busy}>5分早める</button>
        <button className="btn-sub btn-sm" onClick={() => shiftDepart(5)} disabled={busy}>5分遅らせる</button>
        <span className="ml-auto text-gray-500">
          移動時間の出所：{sourceLabel}
          ／ 車両：{vehicles.find((v) => v.id === plan.vehicleId)?.name ?? '-'}
          ／ 現在の設定出発時刻：{departTime}
        </span>
        <button className="btn-primary btn-sm" onClick={() => window.print()}>印刷する</button>
      </div>

      {/* 地図 */}
      <div className="card no-print">
        <h3 className="text-2xl font-bold mb-3">地図</h3>
        {mode === 'fallback' && lastError && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 mb-3">
            <p className="font-bold text-lg">△ {lastError.message}</p>
            <p className="text-gray-700">{lastError.hint}</p>
            <p className="text-gray-500 mt-1">推定値で計算を続けているため、アプリは通常どおり使えます。</p>
          </div>
        )}
        <p className="text-gray-500 mb-2">F＝施設、①②③＝お迎えの順番</p>
        <MapView
          points={mapPoints}
          encodedPolyline={plan.encodedPolyline}
          trafficIntervals={plan.trafficIntervals}
        />
        {plan.trafficIntervals && plan.trafficIntervals.length > 0 && (
          <div className="flex flex-wrap gap-4 mt-3 text-lg">
            <span className="flex items-center gap-2">
              <span className="inline-block w-8 h-2 rounded" style={{ background: '#2f6f4e' }} />順調
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block w-8 h-2 rounded" style={{ background: '#e8a33d' }} />やや混雑
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block w-8 h-2 rounded" style={{ background: '#c0392b' }} />渋滞
            </span>
          </div>
        )}
      </div>

      {/* 並べ替え可能なルート */}
      <div className="card no-print">
        <h3 className="text-2xl font-bold mb-1">送迎ルート</h3>
        <p className="text-gray-500 mb-4">行をドラッグ、または ▲▼ ボタンで順番を変更できます（時刻は自動で再計算）。</p>

        <div className="text-xl font-bold mb-3">🏠 {facility.name}　{toHHMM(plan.departMin)} 出発</div>

        <ul className="space-y-3">
          {plan.stops.map((s, i) => {
            const m = memberOf(s.memberId);
            return (
              <li
                key={s.memberId}
                draggable={!busy}
                onDragStart={() => { if (!busy) dragIdx.current = i; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragIdx.current !== null) move(dragIdx.current, i); dragIdx.current = null; }}
                className={
                  'rounded-2xl border-2 p-4 flex flex-wrap items-center gap-4 cursor-move bg-white ' +
                  (s.lateMin > 0 ? 'border-warn bg-warnSoft' : 'border-gray-200')
                }
              >
                <span className="w-12 h-12 rounded-full bg-accent text-white grid place-items-center text-2xl font-bold">
                  {i + 1}
                </span>
                <div>
                  <p className="text-2xl font-bold">
                    {nameOf(s.memberId)}さん
                    {!m && <span className="badge bg-warnSoft text-warn ml-2">削除済み</span>}
                    {m && !m.active && <span className="badge bg-warnSoft text-warn ml-2">無効</span>}
                  </p>
                  <p className="text-gray-500">
                    希望 {m?.pickupFrom}〜{m?.pickupTo}　乗車 {m?.boardingMinutes}分
                    {m?.note ? `　（${m.note}）` : ''}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-3xl font-bold">{toHHMM(s.arriveMin)}</p>
                  <p className="text-gray-500">
                    移動 {s.travelMin}分
                    {s.distanceKm ? <span>／{s.distanceKm}km</span> : null}
                    {s.waitMin > 0 && <span>／待機 {s.waitMin}分</span>}
                  </p>
                  {s.estimated && <p className="text-gray-500">（この区間は推定値）</p>}
                  {(s.trafficDelayMin ?? 0) > 0 && (
                    <p className="text-warn">
                      通常 {s.staticTravelMin}分 → 予測 {s.travelMin}分（＋{s.trafficDelayMin}分 渋滞）
                    </p>
                  )}
                  {s.lateMin > 0 && <p className="text-warn font-bold">約{s.lateMin}分 遅れ</p>}
                </div>
                <div className="flex flex-col gap-1">
                  <button className="btn-sub btn-sm px-3 py-1" onClick={() => move(i, i - 1)} disabled={busy || i === 0}>▲</button>
                  <button className="btn-sub btn-sm px-3 py-1" onClick={() => move(i, i + 1)} disabled={busy || i === plan.stops.length - 1}>▼</button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="text-xl font-bold mt-4">
          🏠 {facility.name}　{toHHMM(plan.returnMin)} 到着予定
          <span className="text-gray-500 text-lg font-normal">（希望 {facility.arriveBy}／総移動 {plan.totalTravelMin}分
            {plan.totalDistanceKm ? `・${plan.totalDistanceKm}km` : ''}）</span>
        </div>
      </div>

      {/* 印刷用 送迎表（A4縦） */}
      <div className="card print-area">
        <div className="print-only mb-4">
          <h2 className="text-2xl font-bold">
            {fresh.status === 'OUTDATED' ? `${dayPlan?.date} の送迎表` : '本日の送迎表'}
          </h2>
          <p>{todayLabel()}　{facility.name}　{vehicles.find((v) => v.id === plan.vehicleId)?.name}</p>
          <p style={{ fontWeight: 700 }}>
            {plan.travelSource === 'google'
              ? (plan.estimatedLegCount ?? 0) > 0
                ? `⚠ 一部区間（${plan.estimatedLegCount}区間）に推定値を使用しています`
                : '移動時間：Google Maps の実データ（交通状況考慮）'
              : '⚠ デモモード：移動時間は推定値です'}
          </p>
          {fresh.status !== 'READY' && (
            <p style={{ fontWeight: 700 }}>⚠ この送迎表は現在の登録内容と一致していません</p>
          )}
        </div>
        <h3 className="text-2xl font-bold mb-4 no-print">送迎表（印刷プレビュー）</h3>
        <div className="table-scroll">
        <table className="w-full text-left border-collapse min-w-[34rem]">
          <thead>
            <tr className="border-b-2 border-gray-300 text-lg">
              <th className="py-2 w-16">順</th>
              <th className="py-2">利用者</th>
              <th className="py-2 w-28">到着予定</th>
              <th className="py-2 w-24">乗車</th>
              <th className="py-2">備考</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-200 text-lg">
              <td className="py-3">出発</td>
              <td className="py-3 font-bold">{facility.name}</td>
              <td className="py-3 font-bold">{toHHMM(plan.departMin)}</td>
              <td /><td />
            </tr>
            {plan.stops.map((s, i) => (
              <tr key={s.memberId} className="border-b border-gray-200 text-lg">
                <td className="py-3 font-bold">{i + 1}</td>
                <td className="py-3 font-bold">{nameOf(s.memberId)}さん</td>
                <td className="py-3 font-bold">{toHHMM(s.arriveMin)}</td>
                <td className="py-3">{memberOf(s.memberId)?.boardingMinutes}分</td>
                <td className="py-3">{memberOf(s.memberId)?.note}</td>
              </tr>
            ))}
            <tr className="border-b-2 border-gray-300 text-lg">
              <td className="py-3">到着</td>
              <td className="py-3 font-bold">{facility.name}</td>
              <td className="py-3 font-bold">{toHHMM(plan.returnMin)}</td>
              <td /><td />
            </tr>
          </tbody>
        </table>
        </div>
        <p className="mt-4 text-gray-600">
          ※到着時刻は出発時刻 {toHHMM(plan.departMin)} の交通状況をもとにした目安です。当日の状況により前後します。<br />
          ※移動時間の出所：{sourceLabel}
        </p>
      </div>
    </div>
  );
}
