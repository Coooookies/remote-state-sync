import Nanobus from 'nanobus';
import { Patch, SyncOptions, ReceiverItemBusDefinition } from './types';
import { shallowRef, ref, Ref, ShallowRef, triggerRef } from '@vue/reactivity';
import {
  navigatePath,
  setValueAtPath,
  deleteValueAtPath,
  addValueToSet,
  clearValue,
} from './utils';

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
    if (patch.path.length === 0) return;

    if (patch.op === 'clear' || patch.op === 'add') {
      const target = navigatePath(obj, patch.path, 0, patch.path.length);
      if (patch.op === 'clear') {
        clearValue(target);
      } else {
        addValueToSet(target, patch.value);
      }
      return;
    }

    const current = navigatePath(obj, patch.path, 0, patch.path.length - 1);
    const lastKey = patch.path[patch.path.length - 1] as string;

    if (patch.op === 'set') {
      setValueAtPath(current, lastKey, patch.value);
    } else if (patch.op === 'delete') {
      deleteValueAtPath(current, lastKey);
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
    const lastKey = patch.path[patch.path.length - 1];

    if (patch.op === 'set') {
      const current = navigatePath(this.value, patch.path, 1, patch.path.length - 1);
      const refCurrent = navigatePath(
        this._ref ? this._ref.value : null,
        patch.path,
        1,
        patch.path.length - 1,
      );

      setValueAtPath(current, lastKey, patch.value);
      setValueAtPath(refCurrent, lastKey, patch.value);
    } else if (patch.op === 'delete') {
      const current = navigatePath(this.value, patch.path, 1, patch.path.length - 1);
      const refCurrent = navigatePath(
        this._ref ? this._ref.value : null,
        patch.path,
        1,
        patch.path.length - 1,
      );

      deleteValueAtPath(current, lastKey);
      deleteValueAtPath(refCurrent, lastKey);
    } else if (patch.op === 'add') {
      const target = navigatePath(this.value, patch.path, 1, patch.path.length);
      const refTarget = navigatePath(
        this._ref ? this._ref.value : null,
        patch.path,
        1,
        patch.path.length,
      );

      addValueToSet(target, patch.value);
      addValueToSet(refTarget, patch.value);
    } else if (patch.op === 'clear') {
      const target = navigatePath(this.value, patch.path, 1, patch.path.length);
      const refTarget = navigatePath(
        this._ref ? this._ref.value : null,
        patch.path,
        1,
        patch.path.length,
      );

      clearValue(target);
      clearValue(refTarget);
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
