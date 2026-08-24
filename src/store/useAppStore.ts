import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  DayPlan, Facility, Member, MonitoringGoalTerm, MonitoringMonthlyRecord, MonitoringRecord,
  RouteHistoryEntry, RoutePlan, SupportRecord, Vehicle,
} from '../types';
import { sampleFacility, sampleMembers, sampleVehicles } from '../data/sampleData';
import { activeStore } from '../lib/storage';
import { appStorageKey, useTenantStore } from '../lib/tenant';
import { clearMatrixCache } from '../lib/planner';
import { repository, ImportError, type ExportOptions, type PersistedAppData } from '../lib/repository';

interface AppState {
  facility: Facility;
  members: Member[];
  vehicles: Vehicle[];
  selectedIds: string[];
  departTime: string;
  vehicleId: string;
  /** 1日分の送迎計画（複数車両に対応できる入れ物） */
  dayPlan: DayPlan | null;
  /** 表示中の車両（routes配列のindex） */
  activeRouteIndex: number;
  manualOrder: string[] | null;
  /** 過去ルートの履歴（新しい順・最大30件） */
  history: RouteHistoryEntry[];
  /** 画面遷移をまたいで1回だけ表示するお知らせ（永続化しない） */
  notice: string | null;
  /** 支援記録（利用者ごと・複数件を履歴として保持） */
  supportRecords: SupportRecord[];
  /** モニタリング記録（利用者ごと・複数件） */
  monitoringRecords: MonitoringRecord[];
  /** 期間つきの目標（履歴として残す） */
  monitoringGoalTerms: MonitoringGoalTerm[];
  /** 月次のモニタリング記録 */
  monitoringMonthly: MonitoringMonthlyRecord[];

  setFacility: (f: Partial<Facility>) => void;
  addMember: (m: Member) => void;
  updateMember: (id: string, m: Partial<Member>) => void;
  removeMember: (id: string) => void;
  addVehicle: (v: Vehicle) => void;
  updateVehicle: (id: string, v: Partial<Vehicle>) => void;
  removeVehicle: (id: string) => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  setDepartTime: (t: string) => void;
  setVehicleId: (id: string) => void;
  setDayPlan: (p: DayPlan | null) => void;
  setActiveRouteIndex: (i: number) => void;
  /** 表示中の車両のルートだけ差し替える */
  updateActiveRoute: (p: RoutePlan) => void;
  setManualOrder: (ids: string[] | null) => void;
  setNotice: (n: string | null) => void;
  addSupportRecord: (r: SupportRecord) => void;
  updateSupportRecord: (recordId: string, patch: Partial<SupportRecord>) => void;
  removeSupportRecord: (recordId: string) => void;
  supportRecordsOf: (memberId: string) => SupportRecord[];
  addMonitoringRecord: (r: MonitoringRecord) => void;
  updateMonitoringRecord: (id: string, patch: Partial<MonitoringRecord>) => void;
  removeMonitoringRecord: (id: string) => void;
  monitoringRecordsOf: (memberId: string) => MonitoringRecord[];
  addGoalTerm: (t: MonitoringGoalTerm) => void;
  updateGoalTerm: (id: string, patch: Partial<MonitoringGoalTerm>) => void;
  removeGoalTerm: (id: string) => void;
  saveMonthly: (r: MonitoringMonthlyRecord) => void;
  removeMonthly: (id: string) => void;
  /** 作成した計画を履歴へ積む */
  pushHistory: (p: DayPlan) => void;
  /** 同じ利用者構成の直近の履歴を探す（前回ルートの再利用・比較用） */
  findPreviousFor: (memberIds: string[]) => RouteHistoryEntry | null;
  replaceAll: (data: PersistedAppData) => void;
  resetToSample: () => void;
  resetEmpty: (facilityName: string) => void;
}

export const newMemberId = () => 'm-' + Math.random().toString(36).slice(2, 9);
export const newVehicleId = () => 'car-' + Math.random().toString(36).slice(2, 9);
export const newRecordId = () => 'rec-' + Math.random().toString(36).slice(2, 10);
export const newMonitoringId = () => 'mon-' + Math.random().toString(36).slice(2, 10);
export const newGoalTermId = () => 'goal-' + Math.random().toString(36).slice(2, 10);
export const newMonthlyId = () => 'mm-' + Math.random().toString(36).slice(2, 10);

const sampleState = () => ({
  facility: { ...sampleFacility, tenantId: useTenantStore.getState().currentId },
  members: sampleMembers,
  vehicles: sampleVehicles,
  selectedIds: sampleMembers.map((m) => m.id),
  departTime: '08:00',
  vehicleId: 'car-a',
  dayPlan: null,
  activeRouteIndex: 0,
  manualOrder: null,
  history: [] as RouteHistoryEntry[],
  notice: null as string | null,
  supportRecords: [] as SupportRecord[],
  monitoringRecords: [] as MonitoringRecord[],
  monitoringGoalTerms: [] as MonitoringGoalTerm[],
  monitoringMonthly: [] as MonitoringMonthlyRecord[],
});

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...sampleState(),

      setFacility: (f) => set((s) => ({ facility: { ...s.facility, ...f } })),
      addMember: (m) => set((s) => ({ members: [...s.members, m] })),
      updateMember: (id, patch) =>
        set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      removeMember: (id) =>
        set((s) => ({
          members: s.members.filter((m) => m.id !== id),
          selectedIds: s.selectedIds.filter((x) => x !== id),
        })),
      addVehicle: (v) => set((s) => ({ vehicles: [...s.vehicles, v] })),
      updateVehicle: (id, patch) =>
        set((s) => ({ vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) })),
      removeVehicle: (id) =>
        set((s) => {
          // 最後の1台は削除させない（車両が0台だとルートを作れなくなるため）
          if (s.vehicles.length <= 1) return {};
          const vehicles = s.vehicles.filter((v) => v.id !== id);
          return {
            vehicles,
            vehicleId: s.vehicleId === id ? (vehicles.find((v) => v.active) ?? vehicles[0]).id : s.vehicleId,
          };
        }),

      toggleSelected: (id) =>
        set((s) => ({
          selectedIds: s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id],
        })),
      setSelected: (ids) => set({ selectedIds: ids }),
      setDepartTime: (t) => { clearMatrixCache(); set({ departTime: t }); },
      setVehicleId: (id) => set({ vehicleId: id }),
      setDayPlan: (dayPlan) => set({ dayPlan, activeRouteIndex: 0 }),
      setActiveRouteIndex: (activeRouteIndex) => set({ activeRouteIndex }),
      updateActiveRoute: (p) =>
        set((s) => {
          if (!s.dayPlan) return {};
          const routes = s.dayPlan.routes.slice();
          routes[s.activeRouteIndex] = p;
          return { dayPlan: { ...s.dayPlan, routes } };
        }),
      setManualOrder: (ids) => set({ manualOrder: ids }),
      setNotice: (notice) => set({ notice }),

      addSupportRecord: (r) => set((s) => ({ supportRecords: [r, ...s.supportRecords] })),
      updateSupportRecord: (recordId, patch) =>
        set((s) => ({
          supportRecords: s.supportRecords.map((r) =>
            r.recordId === recordId ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
          ),
        })),
      removeSupportRecord: (recordId) =>
        set((s) => ({ supportRecords: s.supportRecords.filter((r) => r.recordId !== recordId) })),
      supportRecordsOf: (memberId) =>
        get().supportRecords
          .filter((r) => r.memberId === memberId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

      addMonitoringRecord: (r) => set((s) => ({ monitoringRecords: [r, ...s.monitoringRecords] })),
      updateMonitoringRecord: (id, patch) =>
        set((s) => ({
          monitoringRecords: s.monitoringRecords.map((r) =>
            r.monitoringRecordId === id
              ? { ...r, ...patch, updatedAt: new Date().toISOString() }
              : r
          ),
        })),
      removeMonitoringRecord: (id) =>
        set((s) => ({
          monitoringRecords: s.monitoringRecords.filter((r) => r.monitoringRecordId !== id),
        })),
      addGoalTerm: (t) => set((s) => ({ monitoringGoalTerms: [...s.monitoringGoalTerms, t] })),
      updateGoalTerm: (id, patch) =>
        set((s) => ({
          monitoringGoalTerms: s.monitoringGoalTerms.map((t) =>
            t.goalTermId === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t
          ),
        })),
      removeGoalTerm: (id) =>
        set((s) => ({
          monitoringGoalTerms: s.monitoringGoalTerms.filter((t) => t.goalTermId !== id),
        })),

      /** 同じ利用者・年・月の記録があれば置き換え、無ければ追加する */
      saveMonthly: (r) =>
        set((s) => {
          const i = s.monitoringMonthly.findIndex(
            (x) => x.memberId === r.memberId && x.year === r.year && x.month === r.month
          );
          const next = s.monitoringMonthly.slice();
          if (i >= 0) next[i] = { ...r, updatedAt: new Date().toISOString() };
          else next.push(r);
          return { monitoringMonthly: next };
        }),
      removeMonthly: (id) =>
        set((s) => ({ monitoringMonthly: s.monitoringMonthly.filter((x) => x.monthlyId !== id) })),

      monitoringRecordsOf: (memberId) =>
        get().monitoringRecords
          .filter((r) => r.memberId === memberId)
          .sort((a, b) =>
            (b.periodTo || b.createdAt).localeCompare(a.periodTo || a.createdAt)
          ),

      pushHistory: (p) =>
        set((s) => {
          const entry: RouteHistoryEntry = {
            id: 'h-' + Math.random().toString(36).slice(2, 9),
            date: p.date,
            createdAt: p.createdAt,
            departTime: p.departTime,
            memberIds: p.routes.flatMap((r) => r.stops.map((x) => x.memberId)),
            orders: p.routes.map((r) => ({
              vehicleId: r.vehicleId,
              memberIds: r.stops.map((x) => x.memberId),
            })),
            totalTravelMin: p.routes.reduce((a, r) => a + r.totalTravelMin, 0),
            returnMin: Math.max(...p.routes.map((r) => r.returnMin), 0),
            hadError: p.routes.some((r) => r.issues.some((i) => i.level === 'error')),
          };
          return { history: [entry, ...s.history].slice(0, 30) };
        }),

      findPreviousFor: (memberIds) => {
        const key = [...memberIds].sort().join(',');
        return (
          get().history.find((h) => [...h.memberIds].sort().join(',') === key) ?? null
        );
      },

      replaceAll: (data) => set({ ...data }),
      resetToSample: () => set(sampleState()),
      resetEmpty: (facilityName) =>
        set({
          facility: {
            ...sampleFacility,
            id: 'fac-' + Math.random().toString(36).slice(2, 8),
            tenantId: useTenantStore.getState().currentId,
            name: facilityName,
            postalCode: '',
            address: '',
          },
          members: [],
          vehicles: [{ id: 'car-a', name: '車両A', capacity: 8, wheelchair: true, active: true }],
          selectedIds: [],
          departTime: get().departTime,
          vehicleId: 'car-a',
          dayPlan: null,
          activeRouteIndex: 0,
          manualOrder: null,
          history: [],
          notice: null,
          supportRecords: [],
          monitoringRecords: [],
          monitoringGoalTerms: [],
          monitoringMonthly: [],
        }),
    }),
    {
      // ★テナント（施設）ごとに保存先を分離する
      name: appStorageKey(useTenantStore.getState().currentId),
      version: 6,
      storage: createJSONStorage(() => activeStore as Storage),
      migrate: (state) => {
        // v1（単一ルート保持）からの移行：作り直しでよいので計画だけ破棄
        const s = state as Partial<AppState> & { plan?: unknown };
        if (s && 'plan' in s) delete s.plan;
        return {
          ...s,
          dayPlan: null,
          activeRouteIndex: 0,
          history: s.history ?? [],
          supportRecords: s.supportRecords ?? [],
          monitoringRecords: s.monitoringRecords ?? [],
          monitoringGoalTerms: s.monitoringGoalTerms ?? [],
          monitoringMonthly: s.monitoringMonthly ?? [],
        } as AppState;
      },
      partialize: (s) => ({
        facility: s.facility,
        members: s.members,
        vehicles: s.vehicles,
        selectedIds: s.selectedIds,
        departTime: s.departTime,
        vehicleId: s.vehicleId,
        dayPlan: s.dayPlan,
        activeRouteIndex: s.activeRouteIndex,
        manualOrder: s.manualOrder,
        history: s.history,
        supportRecords: s.supportRecords,
        monitoringRecords: s.monitoringRecords,
        monitoringGoalTerms: s.monitoringGoalTerms,
        monitoringMonthly: s.monitoringMonthly,
      }),
    }
  )
);

/** 現在のテナントのデータをバックアップJSONとして書き出す */
export async function exportCurrentTenant(options?: ExportOptions): Promise<string> {
  const id = useTenantStore.getState().currentId;
  // 画面上の最新状態を確実に保存してから書き出す
  const s = useAppStore.getState();
  await repository.save(id, {
    facility: s.facility, members: s.members, vehicles: s.vehicles,
    selectedIds: s.selectedIds, departTime: s.departTime, vehicleId: s.vehicleId,
    dayPlan: s.dayPlan, activeRouteIndex: s.activeRouteIndex,
    manualOrder: s.manualOrder, history: s.history,
    supportRecords: s.supportRecords, monitoringRecords: s.monitoringRecords,
    monitoringGoalTerms: s.monitoringGoalTerms, monitoringMonthly: s.monitoringMonthly,
  });
  return repository.exportJson(id, options);
}

/** 取り込み前に中身だけ確認する */
export function inspectBackup(json: string) {
  return repository.inspectJson(json);
}

/**
 * バックアップJSONを現在のテナントへ取り込む。
 * 別施設のファイルは allowTenantMismatch を明示しない限り拒否する。
 */
export async function importCurrentTenant(json: string, allowTenantMismatch = false) {
  const id = useTenantStore.getState().currentId;
  const data = await repository.importJson(id, json, { allowTenantMismatch });
  useAppStore.getState().replaceAll(data);
  clearMatrixCache();
  return data;
}

/** 直前の取り込みを取り消す */
export async function undoImport() {
  const id = useTenantStore.getState().currentId;
  const data = await repository.undoImport(id);
  if (data) {
    useAppStore.getState().replaceAll(data);
    clearMatrixCache();
  }
  return data;
}

export { ImportError };

/** この端末からこの施設のデータを削除する（共有端末の利用後などに使う） */
export async function wipeCurrentTenant() {
  const id = useTenantStore.getState().currentId;
  const name = useTenantStore.getState().current().name;
  await repository.clear(id);
  useAppStore.getState().resetEmpty(name);
  clearMatrixCache();
}

/**
 * 施設（テナント）を切り替える。
 * 保存キーを差し替えてから読み直すことで、他施設のデータが混ざらないようにする。
 * データが未作成の施設に切り替えた場合は、必ず空の状態から始める。
 */
export async function switchTenant(tenantId: string, tenantName: string) {
  const key = appStorageKey(tenantId);
  const existing = activeStore.getItem(key);
  useTenantStore.getState().setCurrentId(tenantId);
  clearMatrixCache();

  useAppStore.persist.setOptions({ name: key });
  if (!existing) {
    // 前の施設のデータが残らないよう、先に初期化してから保存
    useAppStore.getState().resetEmpty(tenantName);
  }
  await useAppStore.persist.rehydrate();
}
