export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  readonly name: string;
}

interface WechatStorageApi {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: string): void;
  removeStorageSync(key: string): void;
}

interface BrowserStorageApi {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryFallback = new Map<string, string>();

export function createStoragePort(): StoragePort {
  const runtime = globalThis as unknown as {
    wx?: Partial<WechatStorageApi>;
    localStorage?: BrowserStorageApi;
  };

  if (isWechatStorage(runtime.wx)) {
    return {
      name: '微信同步存储',
      get: (key) => {
        const value = runtime.wx?.getStorageSync?.(key);
        return typeof value === 'string' ? value : null;
      },
      set: (key, value) => runtime.wx?.setStorageSync?.(key, value),
      remove: (key) => runtime.wx?.removeStorageSync?.(key),
    };
  }

  if (runtime.localStorage !== undefined) {
    return {
      name: '浏览器本地存储',
      get: (key) => runtime.localStorage?.getItem(key) ?? null,
      set: (key, value) => runtime.localStorage?.setItem(key, value),
      remove: (key) => runtime.localStorage?.removeItem(key),
    };
  }

  return {
    name: '内存临时存储',
    get: (key) => memoryFallback.get(key) ?? null,
    set: (key, value) => memoryFallback.set(key, value),
    remove: (key) => memoryFallback.delete(key),
  };
}

function isWechatStorage(value: Partial<WechatStorageApi> | undefined): value is WechatStorageApi {
  return typeof value?.getStorageSync === 'function'
    && typeof value.setStorageSync === 'function'
    && typeof value.removeStorageSync === 'function';
}
