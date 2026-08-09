import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { adaptPreviousOrder, checkVehicleFit, createDayPlan, recalcPlan } from '../lib/planner';

export default function RouteCreate() {
  const {
    facility, members, vehicles, selectedIds, toggleSelected, setSelected,
    departTime, setDepartTime, vehicleId, setVehicleId, setDayPlan, setManualOrder,
    pushHistory, findPreviousFor, setNotice,
  } = useAppStore();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const activeMembers = members.filter((m) => m.active);
  const chosen = activeMembers.filter((m) => selectedIds.includes(m.id));

  const fitIssues = checkVehicleFit(chosen, vehicles.find((v) => v.id === vehicleId));
  const previous = findPreviousFor(chosen.map((m) => m.id));

  const run = async (usePreviousOrder = false) => {
    if (chosen.length === 0) { alert('今日の利用者を1名以上選んでください'); return; }
    setBusy(true);
    setNotice(null);
    try {
      // MVPでは選択中の1台。vehicles を複数渡せば複数車両ぶんの計画が作られる。
      const useVehicles = vehicles.filter((v) => v.id === vehicleId);
      let day = await createDayPlan(facility, chosen, departTime, useVehicles);

      // 「前回と同じ順番で作る」：今日休みの人は外し、新しい人は末尾に足して適用する
      if (usePreviousOrder && previous) {
        const { order, removed, added } = adaptPreviousOrder(
          previous.orders[0].memberIds,
          chosen.map((m) => m.id)
        );
        if (order.length > 0) {
          const route = await recalcPlan(facility, chosen, departTime, useVehicles[0].id, order);
          day = { ...day, routes: [route, ...day.routes.slice(1)] };
          const msgs: string[] = [];
          if (removed.length > 0) msgs.push(`前回から${removed.length}名を除きました`);
          if (added.length > 0) msgs.push(`新しい${added.length}名を末尾に追加しました`);
          setNotice(
            msgs.length > 0
              ? `前回の順番を適用しました（${msgs.join('、')}）。順番はこのあと変更できます。`
              : '前回とまったく同じ順番で作成しました。'
          );
        }
      }

      setDayPlan(day);
      pushHistory(day);
      setManualOrder(day.routes[0]?.stops.map((s) => s.memberId) ?? []);
      navigate('/result');
    } catch (e) {
      alert('ルート作成に失敗しました: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center flex-wrap gap-3 mb-4">
          <h2 className="text-2xl font-bold">① 今日の利用者を選ぶ</h2>
          <span className="text-xl font-bold text-accent">{chosen.length}名 選択中</span>
          <div className="ml-auto flex gap-2">
            <button className="btn-sub btn-sm" onClick={() => setSelected(activeMembers.map((m) => m.id))}>
              全員選択
            </button>
            <button className="btn-sub btn-sm" onClick={() => setSelected([])}>全て解除</button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {activeMembers.map((m) => {
            const on = selectedIds.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggleSelected(m.id)}
                className={
                  'text-left rounded-2xl border-2 p-4 transition ' +
                  (on ? 'border-accent bg-accentSoft' : 'border-gray-200 bg-white hover:bg-gray-50')
                }
              >
                <div className="flex items-center gap-3">
                  <span className={
                    'w-8 h-8 rounded-lg grid place-items-center text-xl font-bold border-2 ' +
                    (on ? 'bg-accent text-white border-accent' : 'border-gray-300 text-transparent')
                  }>✓</span>
                  <span className="text-xl font-bold">{m.name}さん</span>
                  <span className="ml-auto text-gray-600">{m.pickupFrom}〜{m.pickupTo}</span>
                </div>
                {m.note && <p className="text-gray-500 mt-2 ml-11">{m.note}</p>}
              </button>
            );
          })}
        </div>
        {activeMembers.length === 0 && (
          <p className="text-gray-500 text-lg">有効な利用者がいません。利用者管理から登録してください。</p>
        )}
      </div>

      <div className="card grid sm:grid-cols-2 gap-6">
        <div>
          <h2 className="text-2xl font-bold mb-3">② 出発時刻</h2>
          <input className="field text-3xl text-center" type="time" value={departTime}
            onChange={(e) => setDepartTime(e.target.value)} />
          <p className="text-gray-500 mt-2">施設への到着希望：{facility.arriveBy}</p>
          <p className="text-gray-500">この時刻の交通状況を考慮して移動時間を計算します。</p>
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-3">車両</h2>
          <select className="field text-xl" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}（定員{v.capacity}名{v.wheelchair ? '・車いす可' : ''}）</option>
            ))}
          </select>
          {fitIssues.map((f) => (
            <p key={f.code} className="text-warn font-bold mt-2">⚠ {f.message}</p>
          ))}
        </div>
      </div>

      {previous && (
        <div className="card flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xl font-bold">同じ顔ぶれの前回ルートがあります</p>
            <p className="text-gray-600">
              {previous.date}／{previous.departTime}出発／移動 {previous.totalTravelMin}分
              {previous.hadError && <span className="text-warn font-bold">（間に合わない方がいました）</span>}
            </p>
          </div>
          <button className="btn-sub ml-auto" disabled={busy} onClick={() => run(true)}>
            前回と同じ順番で作る
          </button>

        </div>
      )}

      <button className="btn-primary w-full text-2xl py-6" onClick={() => run(false)} disabled={busy}>
        {busy ? '交通状況を考慮して計算中…' : '③ ルートを作成'}
      </button>
    </div>
  );
}
