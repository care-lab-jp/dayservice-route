import { useState } from 'react';
import {
  newVehicleId, useAppStore, switchTenant, exportCurrentTenant, importCurrentTenant, inspectBackup,
  undoImport, wipeCurrentTenant, ImportError,
} from '../store/useAppStore';
import NumberInput from '../components/NumberInput';
import { useTenantStore } from '../lib/tenant';
import { getEnvApiKey, hasGoogleKey } from '../lib/travelProvider';
import {
  clearTenantKey, getTenantKey, isKeyPersisted, looksLikeApiKey, maskKey, setTenantKey,
} from '../lib/keyVault';
import { useApiStatus } from '../lib/apiStatus';
import { clearMatrixCache } from '../lib/planner';

export default function FacilitySettings() {
  const { facility, setFacility, resetToSample, vehicles, addVehicle, updateVehicle, removeVehicle } =
    useAppStore();
  const { mode, lastError, lastSuccess } = useApiStatus();
  const { tenants, currentId, current, addTenant, updateTenant, removeTenant } = useTenantStore();
  const tenant = current();
  const savedKey = getTenantKey(tenant.id);
  const [keyDraft, setKeyDraft] = useState('');
  const sharedAvailable = getEnvApiKey().length > 0;
  const memberCount = useAppStore((s) => s.members.length);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const doSwitch = async (id: string) => {
    const t = tenants.find((x) => x.id === id);
    if (!t) return;
    await switchTenant(id, t.name);
    // APIキーが施設ごとに変わるため、地図ライブラリを読み直す
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      {/* ---------------- 施設（テナント）の切替 ---------------- */}
      <div className="card space-y-4">
        <h2 className="text-2xl font-bold">施設の切替（マルチテナント）</h2>
        <p className="text-gray-600">
          施設ごとにデータは完全に分離して保存されます。他の施設の利用者情報は表示も編集もできません。
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">利用中の施設</label>
            <select className="field text-xl" value={currentId} onChange={(e) => doSwitch(e.target.value)}>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button className="btn-sub" onClick={() => {
              const name = prompt('新しい施設の名前を入力してください');
              if (!name) return;
              const t = addTenant(name);
              doSwitch(t.id);
            }}>＋ 施設を追加</button>
            <button className="btn-danger" disabled={tenants.length <= 1} onClick={() => {
              if (!confirm(`「${tenant.name}」とその全データを削除します。よろしいですか？`)) return;
              removeTenant(tenant.id);
              window.location.reload();
            }}>この施設を削除</button>
          </div>
        </div>
        <div>
          <label className="label">施設（テナント）名</label>
          <input className="field" value={tenant.name}
            onChange={(e) => updateTenant(tenant.id, { name: e.target.value })} />
        </div>
        <p className="text-gray-500">
          保存キー：<code>dayservice-route/t/{tenant.id}</code>
          （将来サーバへ移行する場合も、このテナントIDで分離します）
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="text-2xl font-bold">施設情報</h2>
        <div>
          <label className="label">施設名</label>
          <input className="field" value={facility.name} onChange={(e) => setFacility({ name: e.target.value })} />
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="label">郵便番号</label>
            <input className="field" value={facility.postalCode} onChange={(e) => setFacility({ postalCode: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">住所</label>
            <input className="field" value={facility.address} onChange={(e) => setFacility({ address: e.target.value })} />
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="label">緯度</label>
            <NumberInput value={facility.lat} step={0.0001} min={-90} max={90}
              onChange={(n) => { setFacility({ lat: n }); clearMatrixCache(); }} />
          </div>
          <div>
            <label className="label">経度</label>
            <NumberInput value={facility.lng} step={0.0001} min={-180} max={180}
              onChange={(n) => { setFacility({ lng: n }); clearMatrixCache(); }} />
          </div>
          <div>
            <label className="label">施設への到着希望時刻</label>
            <input className="field" type="time" value={facility.arriveBy}
              onChange={(e) => setFacility({ arriveBy: e.target.value })} />
          </div>
        </div>
        <p className="text-gray-500">
          送迎開始地点・終了地点は未設定の場合、施設の座標が使われます（施設 → 利用者宅巡回 → 施設）。
        </p>
      </div>

      {/* ---------------- 車両 ---------------- */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold">車両（{vehicles.length}台）</h2>
          <button className="btn-sub btn-sm sm:ml-auto"
            onClick={() =>
              addVehicle({
                id: newVehicleId(),
                name: `車両${String.fromCharCode(65 + vehicles.length)}`,
                capacity: 8,
                wheelchair: false,
                active: true,
              })
            }>
            ＋ 車両を追加
          </button>
        </div>
        <p className="text-gray-600">
          定員を超える人数を選んだときや、車いすの方が非対応車両に含まれるときは、
          ルート作成画面で警告が出ます。
        </p>

        <div className="space-y-3">
          {vehicles.map((v) => (
            <div key={v.id} className="rounded-2xl border-2 border-gray-200 p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="label">車両名</label>
                  <input className="field" value={v.name}
                    onChange={(e) => updateVehicle(v.id, { name: e.target.value })} />
                </div>
                <div>
                  <label className="label">定員（名）</label>
                  <NumberInput value={v.capacity} min={1} max={30} integer
                    onChange={(n) => updateVehicle(v.id, { capacity: n })} />
                </div>
                <div>
                  <label className="label">車いす対応</label>
                  <select className="field" value={v.wheelchair ? '1' : '0'}
                    onChange={(e) => updateVehicle(v.id, { wheelchair: e.target.value === '1' })}>
                    <option value="0">非対応</option>
                    <option value="1">対応</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={'badge ' + (v.active ? 'bg-accentSoft text-accent' : 'bg-gray-100 text-gray-500')}>
                  {v.active ? '稼働中' : '停止中'}
                </span>
                <div className="w-full sm:w-auto sm:ml-auto flex gap-2">
                  <button className="btn-sub btn-sm flex-1 sm:flex-none"
                    onClick={() => updateVehicle(v.id, { active: !v.active })}>
                    {v.active ? '停止にする' : '稼働にする'}
                  </button>
                  <button className="btn-danger btn-sm flex-1 sm:flex-none"
                    disabled={vehicles.length <= 1}
                    title={vehicles.length <= 1 ? '車両は1台以上必要です' : ''}
                    onClick={() => {
                      if (confirm(`${v.name}を削除します。よろしいですか？\n作成済みの送迎表がある場合は作り直しが必要になります。`)) {
                        removeVehicle(v.id);
                      }
                    }}>
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-gray-500">
          複数台を「稼働中」にすると、利用者が定員と車いす対応をもとに自動で振り分けられ、
          ルート結果に車両ごとのタブが表示されます。
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="text-2xl font-bold">Google Maps 連携</h2>
        <p className="text-lg">
          現在の状態：{!hasGoogleKey()
            ? <span className="font-bold text-gray-600">デモモード（推定移動時間・簡易マップ）</span>
            : mode === 'fallback'
            ? <span className="font-bold text-warn">接続エラー → デモモードで継続中</span>
            : <span className="font-bold text-accent">Google Maps 連携済み（実道路の移動時間・地図）</span>}
        </p>
        {lastSuccess && mode === 'google' && <p className="text-gray-500">直近の成功: {lastSuccess}</p>}
        {lastError && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="font-bold">△ {lastError.message}</p>
            <p className="text-gray-700">{lastError.hint}</p>
            {lastError.raw && (
              <details className="mt-2 text-gray-500">
                <summary className="cursor-pointer">技術的な詳細</summary>
                <pre className="whitespace-pre-wrap break-all text-xs mt-1">{lastError.raw}</pre>
              </details>
            )}
          </div>
        )}
        <p className="text-lg">
          使用API：Maps JavaScript API（地図）／ Geocoding API（住所検索）／ Routes API（移動時間・道路ルート）
        </p>

        {/* ---- APIキーの利用方式（＝認証・課金の主体） ---- */}
        <div className="rounded-2xl border border-gray-200 p-4 space-y-4">
          <h3 className="text-xl font-bold">この施設のAPIキー</h3>
          <p className="text-gray-600">
            実運用では<strong>施設ご自身のGoogle Cloudプロジェクトのキー</strong>をお使いください。
            地図・移動時間の利用料はそのプロジェクトに請求されます。
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={tenant.keyMode === 'own' ? 'btn-primary' : 'btn-sub'}
              onClick={() => updateTenant(tenant.id, { keyMode: 'own' })}>
              この施設のキーを使う（推奨）
            </button>
            <button className={tenant.keyMode === 'shared' ? 'btn-primary' : 'btn-sub'}
              disabled={!sharedAvailable}
              title={sharedAvailable ? '開発・デモ用' : '共通キーは設定されていません'}
              onClick={() => { updateTenant(tenant.id, { keyMode: 'shared' }); window.location.reload(); }}>
              共通キー（開発・デモ用）
            </button>
            <button className={tenant.keyMode === 'none' ? 'btn-primary' : 'btn-sub'}
              onClick={() => { updateTenant(tenant.id, { keyMode: 'none' }); window.location.reload(); }}>
              使わない（デモモード）
            </button>
          </div>

          {tenant.keyMode === 'shared' && (
            <p className="text-warn font-bold">
              ⚠ 共通キーは開発・体験用です。実際の送迎業務では施設ご自身のキーに切り替えてください。
            </p>
          )}

          {tenant.keyMode === 'own' && (
            <div className="space-y-3">
              <div>
                <label className="label">APIキー</label>
                <div className="flex gap-2">
                  <input className="field" type="password" placeholder="AIza..." value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)} />
                  <button className="btn-primary whitespace-nowrap"
                    onClick={() => {
                      if (keyDraft && !looksLikeApiKey(keyDraft)) {
                        if (!confirm('APIキーの形式が一般的なもの（AIza…）と異なります。このまま保存しますか？')) return;
                      }
                      setTenantKey(tenant.id, keyDraft, tenant.keyStorage);
                      window.location.reload();
                    }}>保存して再読込</button>
                </div>
                {savedKey && (
                  <p className="text-gray-500 mt-2">
                    保存済み：{maskKey(savedKey)}（{isKeyPersisted(tenant.id) ? 'この端末に保存' : 'このタブのみ'}）
                    <button className="btn-sub btn-sm ml-3"
                      onClick={() => { clearTenantKey(tenant.id); window.location.reload(); }}>
                      キーを削除
                    </button>
                  </p>
                )}
              </div>

              <div>
                <label className="label">キーの保存場所</label>
                <select className="field" value={tenant.keyStorage}
                  onChange={(e) => {
                    const storage = e.target.value as 'session' | 'local';
                    updateTenant(tenant.id, { keyStorage: storage });
                    if (savedKey) setTenantKey(tenant.id, savedKey, storage);
                  }}>
                  <option value="session">このタブだけ（共有パソコン向け・ブラウザを閉じると消える）</option>
                  <option value="local">この端末に保存する（施設専用端末向け）</option>
                </select>
                <p className="text-gray-500 mt-2">
                  ブラウザから直接Googleを呼ぶ構成では、キーは必ず端末側に現れます。
                  盗まれても悪用されないよう、<strong>Google Cloud側でHTTPリファラー制限・API制限・割り当て上限</strong>を
                  必ず設定してください。
                </p>
              </div>

              <div>
                <label className="label">交通状況の利用（費用に影響します）</label>
                <select className="field" value={tenant.useTraffic === false ? 'off' : 'on'}
                  onChange={(e) => {
                    updateTenant(tenant.id, { useTraffic: e.target.value === 'on' });
                    clearMatrixCache();
                  }}>
                  <option value="on">交通状況を考慮する（推奨・Routes API Pro 課金）</option>
                  <option value="off">考慮しない（道路条件のみ・Essentials 課金で安価）</option>
                </select>
                <p className="text-gray-500 mt-2">
                  交通状況を使う設定は Routes API の Pro SKU で課金されます。
                  費用を抑えたい場合は「考慮しない」を選べます（渋滞の増加時間は表示されません）。
                </p>
              </div>

              <div>
                <label className="label">Map ID（任意・地図のマーカー表示に使用）</label>
                <input className="field" placeholder="未入力ならテスト用の DEMO_MAP_ID"
                  value={tenant.mapId ?? ''}
                  onChange={(e) => updateTenant(tenant.id, { mapId: e.target.value })} />
                <p className="text-gray-500 mt-2">
                  DEMO_MAP_ID はテスト用です。実運用では施設のGoogle Cloudで作成したMap IDを設定してください。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- データ管理 ---- */}
      <div className="card space-y-4">
        <h2 className="text-2xl font-bold">データの管理</h2>
        <p className="text-gray-600">
          利用者名・住所などのデータは、この端末のブラウザ内にのみ保存されます（サーバへは送信されません）。
          共有のパソコンやタブレットでお使いの場合は、次の点にご注意ください。
        </p>
        <ul className="list-disc pl-6 text-lg space-y-1 text-gray-700">
          <li>端末自体にパスワード／PINロックをかけ、離席時はロックしてください。</li>
          <li>職員ごとにOSのユーザーを分けると、ブラウザの保存領域も分かれます。</li>
          <li>施設の業務端末では、通常のウィンドウでお使いください（データが保存されます）。</li>
          <li>一時的に借りた端末・私物端末では、使い終わりに「この端末のデータを削除」を実行してください。
            必要なら事前に「データを書き出す」でバックアップを取ってください。</li>
          <li>シークレットウィンドウでは閉じた時点で<strong>利用者登録も消えます</strong>。
            日常業務には向きません（借りた端末での一時利用のみ）。</li>
        </ul>
        <label className="flex items-center gap-2 text-lg">
          <input type="checkbox" checked={includeHistory}
            onChange={(e) => setIncludeHistory(e.target.checked)} />
          書き出しに過去ルートの履歴も含める（既定：含めない）
        </label>

        <div className="flex flex-wrap gap-3">
          <button className="btn-sub" onClick={async () => {
            const ok = confirm(
              `利用者 ${memberCount}名の氏名・住所を含むファイルを保存します。\n\n` +
              '・保存先（ダウンロードフォルダ）は他の職員も見られる場合があります\n' +
              '・USBメモリやメール添付での持ち出しは避けてください\n' +
              '・不要になったらファイルを削除してください\n\n書き出しますか？'
            );
            if (!ok) return;
            const json = await exportCurrentTenant({ includeHistory });
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            // ファイル名から施設名を外す（フォルダ一覧で施設が特定されないように）
            a.download = `soso-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}>データを書き出す（バックアップ）</button>

          <label className="btn-sub cursor-pointer">
            データを読み込む
            <input type="file" accept="application/json" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                try {
                  // 1) 中身を検証して確認 -> 2) 取り込み
                  const p = inspectBackup(text);
                  const ok = confirm(
                    `次の内容を取り込みます。\n\n` +
                    `施設：${p.facilityName}\n利用者：${p.memberCount}名\n車両：${p.vehicleCount}台\n` +
                    `書き出し日時：${p.exportedAt ? new Date(p.exportedAt).toLocaleString('ja-JP') : '不明'}\n\n` +
                    '現在のデータは置き換わります（取り込み後に取り消せます）。よろしいですか？'
                  );
                  if (!ok) { e.target.value = ''; return; }
                  await importCurrentTenant(text, false);
                  setCanUndo(true);
                  alert(`取り込みました（利用者${p.memberCount}名・車両${p.vehicleCount}台）。`);
                } catch (err) {
                  if (err instanceof ImportError && err.code === 'TENANT_MISMATCH') {
                    const forceOk = confirm(
                      `${err.message}\n\n別の施設のデータを、この施設（${tenant.name}）に取り込むと\n` +
                      '利用者情報が混ざります。本当に取り込みますか？'
                    );
                    if (forceOk) {
                      await importCurrentTenant(text, true);
                      setCanUndo(true);
                      alert('取り込みました。');
                    }
                  } else {
                    alert('読み込めませんでした：\n' + (err as Error).message);
                  }
                }
                e.target.value = '';
              }} />
          </label>

          {canUndo && (
            <button className="btn-sub" onClick={async () => {
              const d = await undoImport();
              setCanUndo(false);
              alert(d ? '取り込み前の状態に戻しました。' : '戻せる状態がありませんでした。');
            }}>直前の取り込みを取り消す</button>
          )}

          <button className="btn-danger" onClick={async () => {
            if (!confirm(
              `「${tenant.name}」の利用者 ${memberCount}名の情報を含む全データを、この端末から削除します。\n` +
              '元に戻せません。先に「データを書き出す」でバックアップを取ることをおすすめします。\n\n続けますか？'
            )) return;
            const typed = prompt(`確認のため、施設名「${tenant.name}」を入力してください。`);
            if (typed?.trim() !== tenant.name) { alert('施設名が一致しないため中止しました。'); return; }
            await wipeCurrentTenant();
            alert('削除しました。');
          }}>この端末のデータを削除</button>

          <button className="btn-sub" onClick={() => {
            if (memberCount > 0 && !confirm(
              `現在 ${memberCount}名の利用者が登録されています。\nサンプルデータに戻すと、これらは失われます。\n\n続けますか？`
            )) return;
            if (confirm('サンプルデータに戻します。よろしいですか？')) resetToSample();
          }}>サンプルデータに戻す</button>
        </div>
      </div>

    </div>
  );
}
