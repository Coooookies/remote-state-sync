import type { SuperJSONResult } from 'superjson';

export type PatchOperation = 'set' | 'delete' | 'clear' | 'add';

export interface Patch {
  op: PatchOperation;
  key: string;
  path: (string | number)[];
  value?: unknown;
}

export interface SyncOptions {
  snapshotGetter: (namespace: string) => Promise<SyncSnapshot>;
}

export type SyncUpdater<T> = (state: T) => T | void;

export type SyncBusDefinition = {
  update: (namespace: string, patches: Patch[]) => void;
  register: (namespace: string) => void;
};

export type ReceiverItemBusDefinition<T> = {
  update: (newValue: T, oldValue: T, patches: Patch[]) => void;
};

export type SyncSnapshot = SuperJSONResult;
