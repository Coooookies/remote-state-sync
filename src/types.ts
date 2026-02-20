export type PatchOperation = 'set' | 'delete' | 'clear' | 'add';

export interface Patch {
  op: PatchOperation;
  key: string;
  path: (string | number)[];
  value?: unknown;
}

export interface SyncOptions {
  snapshotGetter: (namespace: string) => Promise<Record<string, unknown>>;
}

export type SyncUpdater<T> = (state: T) => T | void;

export type SyncBusDefinition = {
  update: (namespace: string, patches: Patch[]) => void;
};

export type ReceiverItemBusDefinition<T> = {
  update: (newValue: T, oldValue: T, patches: Patch[]) => void;
};
