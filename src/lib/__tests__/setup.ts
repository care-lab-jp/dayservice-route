/** ブラウザ用APIのメモリ実装（Node上でのテスト用） */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), writable: true });
