import { useState } from 'react';
import type { Member } from '../types';
import NumberInput from '../components/NumberInput';
import HelpLink from '../components/HelpLink';
import { HELP_ANCHORS } from '../lib/helpContent';
import {
  KANA_ROWS, countByRow, filterByRow, sortByReading, type KanaRow,
} from '../lib/kana';
import { isValidZip, normalizeZip, tryLookupPostalCode } from '../lib/postalCode';
import { Link } from 'react-router-dom';
import { newMemberId, useAppStore } from '../store/useAppStore';
import { geocodeAddress, hasGoogleKey } from '../lib/travelProvider';
import type { ApiError } from '../lib/apiErrors';
import type { GeocodeCandidate } from '../lib/travelProvider';
import { clearMatrixCache } from '../lib/planner';

const empty = (): Member => ({
  id: newMemberId(), name: '', kana: '', postalCode: '', address: '',
  lat: 34.815, lng: 134.685,
  pickupFrom: '08:10', pickupTo: '08:50',
  dropoffFrom: '16:00', dropoffTo: '16:45',
  boardingMinutes: 3, maxRideMinutes: 40, requiresWheelchair: false,
  note: '', active: true,
});

export default function Members() {
  const { members, addMember, updateMember, removeMember } = useAppStore();
  const [editing, setEditing] = useState<Member | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [geoCandidates, setGeoCandidates] = useState<GeocodeCandidate[]>([]);
  const [zipBusy, setZipBusy] = useState(false);
  const [kanaRow, setKanaRow] = useState<KanaRow | null>(null);

  // あいうえお順に並べ、選んだ行だけを表示する
  const sortedMembers = sortByReading(members);
  const shownMembers = filterByRow(sortedMembers, kanaRow);
  const rowCounts = countByRow(members);
  const { dayPlan, supportRecordsOf } = useAppStore();
  const inTodaysRoute = (id: string) =>
    !!dayPlan?.routes.some((r) => r.stops.some((s) => s.memberId === id));

  const startNew = () => { setEditing(empty()); setIsNew(true); setGeoMsg(null); setGeoCandidates([]); };
  const startEdit = (m: Member) => { setEditing({ ...m }); setIsNew(false); setGeoMsg(null); setGeoCandidates([]); };

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim()) { alert('利用者名を入力してください'); return; }
    if (isNew) addMember(editing); else updateMember(editing.id, editing);
    clearMatrixCache(); // 座標が変わった可能性があるので移動時間のキャッシュを破棄
    setEditing(null);
    setGeoMsg(null);
  };

  /** 郵便番号 -> 住所（送信するのは郵便番号7桁のみ。APIキー不要） */
  const fillFromZip = async (input: string) => {
    if (!editing) return;
    if (!isValidZip(input)) {
      setGeoMsg({ ok: false, text: '郵便番号は7桁で入力してください（例 600-8216）' });
      return;
    }
    setZipBusy(true);
    setGeoMsg(null);
    const { result, error } = await tryLookupPostalCode(input);
    setZipBusy(false);
    if (!result) {
      setGeoMsg({ ok: false, text: `${error?.message ?? '住所を取得できませんでした'} ${error?.hint ?? ''}` });
      return;
    }
    setEditing((prev) =>
      prev ? { ...prev, postalCode: result.formattedZip, address: result.address } : prev
    );
    setGeoMsg({ ok: true, text: `住所を入れました：${result.address}（このあと番地を追記してください）` });
  };

  /** 住所 -> 緯度経度（Googleへ送信するのは住所文字列のみ。氏名・備考は送らない） */
  const lookup = async () => {
    if (!editing) return;
    setBusy(true);
    setGeoMsg(null);
    setGeoCandidates([]);
    try {
      const r = await geocodeAddress(editing.address);
      setEditing({ ...editing, lat: r.lat, lng: r.lng });
      setGeoCandidates(r.candidates.length > 1 ? r.candidates : []);
      setGeoMsg({
        ok: true,
        text:
          r.candidates.length > 1
            ? `候補が${r.candidates.length}件見つかりました。正しい住所を選んでください（暫定で1件目を設定しています）。`
            : `座標を取得しました：${r.formattedAddress}`,
      });
    } catch (e) {
      const err = e as ApiError;
      setGeoMsg({
        ok: false,
        text: `${err?.message ?? '住所を取得できませんでした'} ${err?.hint ?? ''}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-bold">利用者管理（{members.length}名）</h2>
        <div className="ml-auto flex items-center gap-2">
          <HelpLink anchor={HELP_ANCHORS.members} />
          <button className="btn-primary" onClick={startNew}>＋ 新規登録</button>
        </div>
      </div>

      {/* 五十音での絞り込み */}
      <div className="card">
        <p className="label">名前で絞り込む（あいうえお順）</p>
        <div className="grid grid-cols-6 sm:flex sm:flex-wrap gap-2">
          <button onClick={() => setKanaRow(null)}
            className={
              'rounded-xl px-3 py-3 text-base sm:text-lg font-bold border-2 ' +
              (kanaRow === null
                ? 'bg-accent text-white border-accent'
                : 'bg-white text-ink border-gray-500 hover:bg-gray-100')
            }>
            すべて
          </button>
          {KANA_ROWS.map((r) => {
            const count = rowCounts[r];
            const on = kanaRow === r;
            return (
              <button key={r} onClick={() => setKanaRow(on ? null : r)}
                disabled={count === 0}
                title={count === 0 ? 'この行の利用者はいません' : `${count}名`}
                className={
                  'rounded-xl px-3 py-3 text-base sm:text-lg font-bold border-2 ' +
                  (on
                    ? 'bg-accent text-white border-accent'
                    : count === 0
                    ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'bg-white text-ink border-gray-500 hover:bg-gray-100')
                }>
                {r}
              </button>
            );
          })}
        </div>
        {kanaRow && (
          <p className="text-gray-600 mt-2">
            「{kanaRow}」行の{shownMembers.length}名を表示しています。
          </p>
        )}
      </div>

      <div className="space-y-3">
        {shownMembers.length === 0 && (
          <div className="card text-center text-gray-500 text-lg">
            表示できる利用者がいません。
          </div>
        )}
        {shownMembers.map((m) => (
          <div key={m.id} className="card flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="min-w-[10rem]">
              <p className="text-xl font-bold">
                {m.name}さん
                {!m.active && <span className="badge bg-gray-100 text-gray-500 ml-2">無効</span>}
              </p>
              {m.kana && <p className="text-gray-500">{m.kana}</p>}
              <p className="text-gray-500">〒{m.postalCode} {m.address}</p>
            </div>
            <div className="text-lg">
              お迎え {m.pickupFrom}〜{m.pickupTo} ／ 乗車 +{m.boardingMinutes}分
              {m.requiresWheelchair && <span className="badge bg-accentSoft text-accent ml-2">車いす</span>}
              {m.note && <span className="text-gray-500 ml-2">（{m.note}）</span>}
            </div>
            <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap gap-2">
              <button className="btn-sub btn-sm flex-1 sm:flex-none" onClick={() => updateMember(m.id, { active: !m.active })}>
                {m.active ? '無効にする' : '有効にする'}
              </button>
              <Link to={`/support/${m.id}`} className="btn-sub btn-sm flex-1 sm:flex-none">
                支援記録{supportRecordsOf(m.id).length > 0 ? `（${supportRecordsOf(m.id).length}）` : ''}
              </Link>
              <Link to={`/monitoring/${m.id}`} className="btn-sub btn-sm flex-1 sm:flex-none">
                モニタリング
              </Link>
              <button className="btn-sub btn-sm flex-1 sm:flex-none" onClick={() => startEdit(m)}>編集</button>
              <button className="btn-danger btn-sm flex-1 sm:flex-none"
                onClick={() => {
                  const inRoute = inTodaysRoute(m.id);
                  const msg = inRoute
                    ? `${m.name}さんは本日の送迎ルートに含まれています。\n削除すると送迎表は作り直しになります。\n\n本日お休みなだけであれば「無効にする」をお使いください。\n\n本当に削除しますか？（元に戻せません）`
                    : `${m.name}さんの登録（住所・希望時間など）を削除します。\n元に戻せません。\n\n本日お休みなだけであれば「無効にする」をお使いください。\n\n削除しますか？`;
                  if (confirm(msg)) removeMember(m.id);
                }}>
                削除
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 grid place-items-start sm:place-items-center p-2 sm:p-4 z-50 overflow-auto">
          <div className="card w-full max-w-2xl space-y-4 my-4 sm:my-8">
            <h3 className="text-2xl font-bold">{isNew ? '利用者の新規登録' : '利用者の編集'}</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">利用者名</label>
                <input className="field" value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <label className="label">ふりがな（あいうえお順の並べ替えに使います）</label>
                <input className="field" placeholder="やまだ たろう"
                  value={editing.kana ?? ''}
                  onChange={(e) => setEditing({ ...editing, kana: e.target.value })} />
              </div>
              <div>
                <label className="label">郵便番号（入力すると住所が入ります）</label>
                <div className="flex gap-2">
                  <input className="field" inputMode="numeric" placeholder="600-8216"
                    value={editing.postalCode}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setEditing({ ...editing, postalCode: raw });
                      // 7桁そろった時点で自動検索
                      if (isValidZip(raw) && normalizeZip(raw) !== normalizeZip(editing.postalCode)) {
                        void fillFromZip(raw);
                      }
                    }} />
                  <button className="btn-sub whitespace-nowrap" disabled={zipBusy}
                    onClick={() => void fillFromZip(editing.postalCode)}>
                    {zipBusy ? '検索中…' : '住所を入れる'}
                  </button>
                </div>
              </div>
            </div>
            <div>
              <label className="label">住所</label>
              <div className="flex gap-2">
                <input className="field" value={editing.address}
                  onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
                <button className="btn-sub whitespace-nowrap" disabled={!hasGoogleKey() || busy} onClick={lookup}
                  title={hasGoogleKey() ? '' : 'Google Maps APIキー未設定のため利用できません'}>
                  {busy ? '検索中…' : '住所から座標'}
                </button>
              </div>
              {geoMsg && (
                <p className={'mt-2 ' + (geoMsg.ok ? 'text-accent' : 'text-warn font-bold')}>
                  {geoMsg.ok ? '✓ ' : '⚠ '}{geoMsg.text}
                </p>
              )}
              {geoCandidates.length > 1 && (
                <div className="mt-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 space-y-2">
                  <p className="font-bold">住所の候補（誤った場所を登録しないよう必ずご確認ください）</p>
                  {geoCandidates.map((c, i) => (
                    <label key={i} className="flex items-start gap-2 text-lg">
                      <input type="radio" name="geo-candidate" className="mt-2"
                        checked={editing.lat === c.lat && editing.lng === c.lng}
                        onChange={() => setEditing({ ...editing, lat: c.lat, lng: c.lng })} />
                      <span>
                        {c.formattedAddress}
                        {c.locationType && <span className="text-gray-500">（{c.locationType}）</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {!hasGoogleKey() && (
                <p className="mt-2 text-gray-500">
                  デモモードのため住所検索は使えません。緯度・経度を直接入力してください。
                </p>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">緯度</label>
                <NumberInput value={editing.lat} step={0.0001} min={-90} max={90}
                  onChange={(n) => setEditing({ ...editing, lat: n })} />
              </div>
              <div>
                <label className="label">経度</label>
                <NumberInput value={editing.lng} step={0.0001} min={-180} max={180}
                  onChange={(n) => setEditing({ ...editing, lng: n })} />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">お迎え希望時間</label>
                <div className="flex items-center gap-2">
                  <input className="field" type="time" value={editing.pickupFrom}
                    onChange={(e) => setEditing({ ...editing, pickupFrom: e.target.value })} />
                  <span>〜</span>
                  <input className="field" type="time" value={editing.pickupTo}
                    onChange={(e) => setEditing({ ...editing, pickupTo: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">お送り希望時間</label>
                <div className="flex items-center gap-2">
                  <input className="field" type="time" value={editing.dropoffFrom}
                    onChange={(e) => setEditing({ ...editing, dropoffFrom: e.target.value })} />
                  <span>〜</span>
                  <input className="field" type="time" value={editing.dropoffTo}
                    onChange={(e) => setEditing({ ...editing, dropoffTo: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label">乗車時間補正（分）</label>
                <NumberInput value={editing.boardingMinutes} min={0} max={60} integer
                  onChange={(n) => setEditing({ ...editing, boardingMinutes: n })} />
              </div>
              <div>
                <label className="label">車内時間の上限（分）</label>
                <NumberInput value={editing.maxRideMinutes ?? 40} min={10} max={180} integer
                  onChange={(n) => setEditing({ ...editing, maxRideMinutes: n })} />
              </div>
              <div>
                <label className="label">車いす</label>
                <select className="field" value={editing.requiresWheelchair ? '1' : '0'}
                  onChange={(e) => setEditing({ ...editing, requiresWheelchair: e.target.value === '1' })}>
                  <option value="0">不要</option>
                  <option value="1">車いす対応が必要</option>
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">有効／無効</label>
                <select className="field" value={editing.active ? '1' : '0'}
                  onChange={(e) => setEditing({ ...editing, active: e.target.value === '1' })}>
                  <option value="1">有効</option>
                  <option value="0">無効</option>
                </select>
              </div>
              <div />
            </div>
            <div>
              <label className="label">備考</label>
              <input className="field" value={editing.note}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button className="btn-sub" onClick={() => setEditing(null)}>キャンセル</button>
              <button className="btn-primary" onClick={save}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
