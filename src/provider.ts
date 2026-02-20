import Nanobus from 'nanobus';
import { Patch, SyncBusDefinition, SyncUpdater } from './types';
import { createDeepProxy } from './proxy';

export class SyncProvider {
  private namespaces = new Map<string, SyncNamespaceProvider>();
  public readonly bus = new Nanobus<SyncBusDefinition>('SyncProvider');

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

  public async getStateSnapshot(namespace: string): Promise<Record<string, unknown>> {
    const ns = this.namespaces.get(namespace);
    if (!ns) {
      throw new Error(`Namespace ${namespace} not found`);
    }
    return ns.getSnapshot();
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

  public getSnapshot(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const [key, item] of this.items.entries()) {
      snapshot[key] = item.toValue();
    }
    return snapshot;
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

  public toValue(): T {
    // Return original unproxied value if needed, but since we are modifying state,
    // we return the proxied value or we need a deep clone.
    // Deep clone might be expensive, so we return the proxied value for now.
    return this.value;
  }

  private setValue(newVal: T) {
    // If it's a replacement of the entire value, emit a root set patch
    this.onPatch({
      op: 'set',
      key: this.key,
      path: [],
      value: newVal,
    });

    // We proxy it so deep modifications trigger patches
    this.value = createDeepProxy(newVal, this.key, [], this.onPatch);
  }
}
