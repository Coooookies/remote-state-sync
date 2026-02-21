import Nanobus from 'nanobus';
import SuperJSON from 'superjson';
import { createDeepProxy } from './proxy';
import type { Patch, SyncBusDefinition, SyncStateSnapshot, SyncUpdater } from './types';

export class SyncProvider {
  public readonly bus = new Nanobus<SyncBusDefinition>('SyncProvider');
  private namespaces = new Map<string, SyncNamespaceProvider>();

  constructor() {}

  public register(namespace: string): SyncNamespaceProvider {
    if (this.namespaces.has(namespace)) {
      return this.namespaces.get(namespace)!;
    }
    const ns = new SyncNamespaceProvider(namespace, this.bus);
    this.namespaces.set(namespace, ns);
    this.bus.emit('register', namespace);
    return ns;
  }

  public getStateSnapshot(namespace: string, key: string): SyncStateSnapshot {
    const ns = this.namespaces.get(namespace);
    if (!ns) {
      throw new Error(`Namespace ${namespace} not found`);
    }
    return ns.getSnapshot(key);
  }
}

export class SyncNamespaceProvider {
  private items = new Map<string, SyncItemProvider<unknown>>();
  private queuedPatches: Patch[] = [];
  private emitTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly namespace: string,
    private bus: Nanobus<SyncBusDefinition>,
  ) {}

  public sync<T>(key: string, initialValue?: T): SyncItemProvider<T> {
    if (this.items.has(key)) {
      throw new Error(`Item ${key} already registered in namespace ${this.namespace}`);
    }

    const item = new SyncItemProvider<T>(key, initialValue, (patch) => {
      this.queuePatch(patch);
    });
    this.items.set(key, item as SyncItemProvider<unknown>);
    return item;
  }

  public getSnapshot(key: string): SyncStateSnapshot {
    const item = this.items.get(key);
    if (!item) {
      throw new Error(`Item ${key} not found in namespace ${this.namespace}`);
    }
    return item.toStructure();
  }

  private queuePatch(patch: Patch) {
    this.queuedPatches.push(patch);
    if (!this.emitTimeout) {
      this.emitTimeout = setTimeout(() => {
        this.emitPatches();
      }, 0);
    }
  }

  private emitPatches() {
    if (this.queuedPatches.length === 0) return;
    const patches = [...this.queuedPatches];
    this.queuedPatches = [];
    this.emitTimeout = null;
    this.bus.emit('update', this.namespace, patches);
  }
}

export class SyncItemProvider<T> {
  private value!: T;
  private rawValue!: T;

  constructor(
    public readonly key: string,
    initialValue: T | undefined,
    private onPatch: (patch: Patch) => void,
  ) {
    if (initialValue !== undefined) {
      this.setValue(initialValue);
    }
  }

  public set(valOrUpdater: T | SyncUpdater<T>): void {
    if (typeof valOrUpdater === 'function') {
      const updater = valOrUpdater as SyncUpdater<T>;
      const returnVal = updater(this.value);
      if (returnVal !== undefined) {
        this.setValue(returnVal as T);
      }
    } else {
      this.setValue(valOrUpdater);
    }
  }

  public get raw(): Readonly<T> {
    return this.rawValue;
  }

  public toStructure(): SyncStateSnapshot {
    return SuperJSON.serialize(this.rawValue);
  }

  private setValue(newVal: T) {
    this.rawValue = newVal;
    this.onPatch({
      op: 'set',
      key: this.key,
      path: [],
      value: newVal,
    });

    this.value = createDeepProxy(newVal, this.key, [], this.onPatch);
  }
}
