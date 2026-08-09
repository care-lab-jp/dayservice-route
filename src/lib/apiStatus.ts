/**
 * Google Maps 連携の状態を1か所で保持し、ヘッダーや結果画面に表示する。
 * （ルート計算ロジックからは独立）
 */
import { create } from 'zustand';
import type { ApiError } from './apiErrors';

export type ConnectionMode = 'demo' | 'google' | 'fallback';

interface ApiStatusState {
  mode: ConnectionMode;
  lastError: ApiError | null;
  /** 直近に成功したAPI名の記録（デバッグ・安心材料用） */
  lastSuccess: string | null;
  setMode: (m: ConnectionMode) => void;
  reportError: (e: ApiError) => void;
  reportSuccess: (api: string) => void;
  clearError: () => void;
}

export const useApiStatus = create<ApiStatusState>((set) => ({
  mode: 'demo',
  lastError: null,
  lastSuccess: null,
  setMode: (mode) => set({ mode }),
  reportError: (lastError) => set({ lastError }),
  reportSuccess: (lastSuccess) => set({ lastSuccess, lastError: null, mode: 'google' }),
  clearError: () => set({ lastError: null }),
}));

/** React外（lib層）からも呼べるヘルパー */
export const apiStatus = {
  error: (e: ApiError) => useApiStatus.getState().reportError(e),
  success: (api: string) => useApiStatus.getState().reportSuccess(api),
  mode: (m: ConnectionMode) => useApiStatus.getState().setMode(m),
  fallback: (e: ApiError) => {
    useApiStatus.setState({ mode: 'fallback', lastError: e });
  },
};
