/**
 * 「この送迎表は、いまの設定と一致しているか？」を判定する。
 *
 * 利用者の削除・無効化・住所変更・希望時間変更・車両設定変更・出発時刻変更・日付またぎ——
 * これらはすべて「作成済みの送迎表が現状と食い違う」という同じ事故につながる。
 * 個別にフラグを立てると立て忘れが必ず起きるため、
 * 作成時の指紋(PlanSnapshot)と現在の設定を突き合わせる方式にしている（＝派生値）。
 */
import type {
  DayPlan, Facility, Member, PlanFreshness, PlanSnapshot, Vehicle,
} from '../types';

export function memberFingerprint(m: Member): string {
  return [
    m.name, m.lat, m.lng, m.pickupFrom, m.pickupTo,
    m.boardingMinutes, m.maxRideMinutes ?? '', m.requiresWheelchair ? 'w' : '',
    m.active ? 'on' : 'off',
  ].join('|');
}

export function vehicleFingerprint(v: Vehicle): string {
  return [v.name, v.capacity, v.wheelchair ? 'w' : '', v.active ? 'on' : 'off'].join('|');
}

export function facilityFingerprint(f: Facility): string {
  return [f.name, f.lat, f.lng, f.arriveBy].join('|');
}

export function buildSnapshot(
  facility: Facility, members: Member[], vehicles: Vehicle[], departTime: string
): PlanSnapshot {
  return {
    facility: facilityFingerprint(facility),
    departTime,
    members: Object.fromEntries(members.map((m) => [m.id, memberFingerprint(m)])),
    vehicles: Object.fromEntries(vehicles.map((v) => [v.id, vehicleFingerprint(v)])),
  };
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 判定。
 *  OUTDATED : 別の日に作られた送迎表（今日のものではない）
 *  STALE    : 今日のものだが、作成後に設定が変わっている
 *  READY    : 現在の設定と一致
 */
export function planFreshness(
  dayPlan: DayPlan | null,
  ctx: { facility: Facility; members: Member[]; vehicles: Vehicle[]; departTime: string; today?: string }
): PlanFreshness {
  const empty: PlanFreshness = { status: 'READY', reasons: [], missingMemberIds: [], inactiveMemberIds: [] };
  if (!dayPlan || dayPlan.routes.length === 0) return empty;

  const today = ctx.today ?? todayKey();
  const reasons: string[] = [];
  const missing: string[] = [];
  const inactive: string[] = [];

  const stopIds = dayPlan.routes.flatMap((r) => r.stops.map((s) => s.memberId));
  const byId = new Map(ctx.members.map((m) => [m.id, m]));

  for (const id of stopIds) {
    const m = byId.get(id);
    if (!m) { missing.push(id); continue; }
    if (!m.active) inactive.push(id);
  }

  if (dayPlan.date !== today) {
    return {
      status: 'OUTDATED',
      reasons: [`この送迎表は ${dayPlan.date} に作成されたものです（本日は ${today}）。`],
      missingMemberIds: missing,
      inactiveMemberIds: inactive,
    };
  }

  const snap = dayPlan.snapshot;
  if (missing.length > 0) {
    reasons.push(`送迎表に含まれる利用者 ${missing.length}名が削除されています。`);
  }
  if (inactive.length > 0) {
    const names = inactive.map((id) => byId.get(id)?.name).filter(Boolean).join('・');
    reasons.push(`${names}さんは現在「無効」に設定されています。`);
  }

  if (snap) {
    if (snap.departTime !== ctx.departTime) {
      reasons.push(`出発時刻の設定が ${snap.departTime} から ${ctx.departTime} に変更されています。`);
    }
    if (snap.facility !== facilityFingerprint(ctx.facility)) {
      reasons.push('施設情報（住所・到着希望時刻など）が変更されています。');
    }
    const changed: string[] = [];
    for (const id of stopIds) {
      const m = byId.get(id);
      if (!m) continue;
      if (snap.members[id] && snap.members[id] !== memberFingerprint(m)) changed.push(m.name);
    }
    if (changed.length > 0) {
      reasons.push(`${[...new Set(changed)].join('・')}さんの登録内容が変更されています。`);
    }
    for (const r of dayPlan.routes) {
      const v = ctx.vehicles.find((x) => x.id === r.vehicleId);
      if (!v) { reasons.push('使用した車両が削除されています。'); continue; }
      if (snap.vehicles[v.id] && snap.vehicles[v.id] !== vehicleFingerprint(v)) {
        reasons.push(`${v.name}の設定（定員・車いす対応・稼働）が変更されています。`);
      }
    }
  }

  return {
    status: reasons.length > 0 ? 'STALE' : 'READY',
    reasons,
    missingMemberIds: missing,
    inactiveMemberIds: inactive,
  };
}
