import Nanobus from 'nanobus';
import { Patch, SyncOptions, ReceiverItemBusDefinition } from './types';
import { shallowRef, ref, Ref, ShallowRef, triggerRef } from '@vue/reactivity';

export class SyncReceiver {
  private namespaces = new Map<string, SyncNamespaceReceiver>();

  constructor(private options: SyncOptions) {}

  public async register(namespace: string): Promise<SyncNamespaceReceiver> {
    if (this.namespaces.has(namespace)) {
      return this.namespaces.get(namespace)!;
    }

    const snapshot = await this.options.snapshotGetter(namespace);
    const ns = new SyncNamespaceReceiver(namespace, snapshot);
    this.namespaces.set(namespace, ns);
    return ns;
  }

  public applyPatches(namespace: string, patches: Patch[]): void {
    const ns = this.namespaces.get(namespace);
    if (ns) {
      ns.applyPatches(patches);
    }
  }
}

export class SyncNamespaceReceiver {
  private items = new Map<string, SyncItemReceiver<unknown>>();

  constructor(
    public readonly namespace: string,
    private snapshot: Record<string, unknown>,
  ) {}

  public sync<T>(key: string): SyncItemReceiver<T> {
    if (this.items.has(key)) {
      return this.items.get(key) as SyncItemReceiver<T>;
    }

    const val = this.snapshot[key] as T;
    const item = new SyncItemReceiver<T>(key, val);
    this.items.set(key, item as SyncItemReceiver<unknown>);
    return item;
  }

  public applyPatches(patches: Patch[]): void {
    const affectedItems = new Map<
      SyncItemReceiver<unknown>,
      { oldVal: unknown; patches: Patch[] }
    >();
    for (const patch of patches) {
      if (patch.path.length === 0) continue;
      const key = patch.path[0] as string;
      const item = this.items.get(key);
      if (item) {
        if (!affectedItems.has(item)) {
          affectedItems.set(item, { oldVal: item.toValue(), patches: [] });
        }
        item.applyPatch(patch);
        affectedItems.get(item)!.patches.push(patch);
      } else {
        // Update the snapshot in case the item hasn't been synced yet
        this.applyPatchToObject(this.snapshot, patch);
      }
    }
    for (const [item, data] of affectedItems.entries()) {
      item.triggerReactivity();
      item.bus.emit('update', item.toValue(), data.oldVal, data.patches);
    }
  }

  private applyPatchToObject(obj: unknown, patch: Patch) {
    let current = obj as Record<string, unknown>;
    for (let i = 0; i < patch.path.length - 1; i++) {
      current = current[patch.path[i] as string] as Record<string, unknown>;
      if (!current) return;
    }
    const lastKey = patch.path[patch.path.length - 1] as string;
    if (patch.op === 'set') {
      current[lastKey] = patch.value;
    } else if (patch.op === 'delete') {
      delete current[lastKey];
    } else if (patch.op === 'add') {
      if (current instanceof Set) {
        current.add(patch.value);
      }
    } else if (patch.op === 'clear') {
      // Technically in our set it clears the whole Set/Map, so current is the object itself at path
      // For clear, the patch.path is the exact path (not its parent)
      current = obj as Record<string, unknown>;
      for (let i = 0; i < patch.path.length; i++) {
        current = current[patch.path[i] as string] as Record<string, unknown>;
      }
      if (current && typeof (current as unknown as Map<unknown, unknown>).clear === 'function') {
        (current as unknown as Map<unknown, unknown>).clear();
      }
    }
  }
}

export class SyncItemReceiver<T> {
  private value: T;
  private _ref: Ref<T> | null = null;
  private _shallowRef: ShallowRef<T> | null = null;
  public bus = new Nanobus<ReceiverItemBusDefinition<T>>('SyncItemReceiver');

  constructor(
    public readonly key: string,
    initialValue: T,
  ) {
    this.value = initialValue;
  }

  public on(event: 'update', cb: (newValue: T, oldValue: T, patches: Patch[]) => void): void {
    this.bus.on(event, cb);
  }

  public toValue(): T {
    return this.value;
  }

  public toRef(): Ref<T> {
    if (!this._ref) {
      this._ref = ref(this.value) as Ref<T>;
    }
    return this._ref;
  }

  public toShallowRef(): ShallowRef<T> {
    if (!this._shallowRef) {
      this._shallowRef = shallowRef(this.value) as ShallowRef<T>;
    }
    return this._shallowRef;
  }

  public applyPatch(patch: Patch): void {
    if (patch.path.length === 1) {
      // Root level patch (e.g. key replacement)
      if (patch.op === 'set') {
        this.value = patch.value as T;
        if (this._ref) this._ref.value = patch.value as T;
        if (this._shallowRef) this._shallowRef.value = patch.value as T;
      }
      return;
    }

    // Nested patch
    let current: unknown = this.value;
    let refCurrent: unknown = this._ref ? this._ref.value : null;

    // We skip the first element of path, because it is the root key
    for (let i = 1; i < patch.path.length - 1; i++) {
      const step = patch.path[i] as string;
      if (current instanceof Map) {
        current = current.get(step);
      } else {
        current = (current as Record<string, unknown>)[step];
      }
      if (refCurrent) {
        if (refCurrent instanceof Map) {
          refCurrent = refCurrent.get(step);
        } else {
          refCurrent = (refCurrent as Record<string, unknown>)[step];
        }
      }
      if (current === undefined || current === null) return;
    }

    const lastKey = patch.path[patch.path.length - 1] as string;

    if (patch.op === 'set') {
      if (current instanceof Map) {
        current.set(lastKey, patch.value);
        if (refCurrent && refCurrent instanceof Map) refCurrent.set(lastKey, patch.value);
      } else {
        (current as Record<string, unknown>)[lastKey] = patch.value;
        if (refCurrent) (refCurrent as Record<string, unknown>)[lastKey] = patch.value;
      }
    } else if (patch.op === 'delete') {
      if (current instanceof Map) {
        current.delete(lastKey);
        if (refCurrent && refCurrent instanceof Map) refCurrent.delete(lastKey);
      } else {
        delete (current as Record<string, unknown>)[lastKey];
        if (refCurrent) delete (refCurrent as Record<string, unknown>)[lastKey];
      }
    } else if (patch.op === 'add') {
      // "add" is used by Set; its path is the set itself.
      // E.g. patch.path = ['key', 'nestedSet']
      current = this.value;
      refCurrent = this._ref ? this._ref.value : null;
      for (let i = 1; i < patch.path.length; i++) {
        if (current instanceof Map) current = current.get(patch.path[i]);
        else current = (current as Record<string, unknown>)[patch.path[i] as string];
        if (refCurrent) {
          if (refCurrent instanceof Map) refCurrent = refCurrent.get(patch.path[i]);
          else refCurrent = (refCurrent as Record<string, unknown>)[patch.path[i] as string];
        }
      }
      if (current instanceof Set) {
        current.add(patch.value);
        if (refCurrent && refCurrent instanceof Set) refCurrent.add(patch.value);
      }
    } else if (patch.op === 'clear') {
      current = this.value;
      refCurrent = this._ref ? this._ref.value : null;
      for (let i = 1; i < patch.path.length; i++) {
        if (current instanceof Map) current = current.get(patch.path[i]);
        else current = (current as Record<string, unknown>)[patch.path[i] as string];
        if (refCurrent) {
          if (refCurrent instanceof Map) refCurrent = refCurrent.get(patch.path[i]);
          else refCurrent = (refCurrent as Record<string, unknown>)[patch.path[i] as string];
        }
      }
      if (current && typeof (current as unknown as Map<unknown, unknown>).clear === 'function') {
        (current as unknown as Map<unknown, unknown>).clear();
        if (
          refCurrent &&
          typeof (refCurrent as unknown as Map<unknown, unknown>).clear === 'function'
        )
          (refCurrent as unknown as Map<unknown, unknown>).clear();
      }
    }
  }

  public triggerReactivity() {
    if (this._shallowRef) {
      triggerRef(this._shallowRef);
    }
    // ref deeply tracks automatically for some mutations, but just to be sure we trigger.
    // However triggerRef doesn't work perfectly on plain refs in all edge cases if internal nested structures are replaced directly
    // For typical vue usage map/set mutating works fine.
  }

  public dispose() {
    this._ref = null;
    this._shallowRef = null;
  }
}
