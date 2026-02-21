import Nanobus from 'nanobus';
import SuperJSON from 'superjson';
import {
  shallowRef,
  ref,
  type Ref,
  type ShallowRef,
  triggerRef,
  readonly,
  type DeepReadonly,
} from '@vue/reactivity';
import {
  navigatePath,
  setValueAtPath,
  deleteValueAtPath,
  addValueToSet,
  clearValue,
  deepStructureClone,
} from './utils';
import type { Patch, SyncOptions, ReceiverItemBusDefinition, SyncStateSnapshot } from './types';

export class SyncReceiver {
  private namespaces = new Map<string, SyncNamespaceReceiver>();

  constructor(private options: SyncOptions) {}

  public register(namespace: string): SyncNamespaceReceiver {
    if (this.namespaces.has(namespace)) {
      return this.namespaces.get(namespace)!;
    }

    const ns = new SyncNamespaceReceiver(namespace, this.options.snapshotGetter);
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
    private snapshotGetter: (namespace: string, key: string) => Promise<SyncStateSnapshot>,
  ) {}

  public async sync<T>(key: string): Promise<SyncItemReceiver<T>> {
    if (this.items.has(key)) {
      return this.items.get(key) as SyncItemReceiver<T>;
    }

    const snapshot = await this.snapshotGetter(this.namespace, key);
    const val = SuperJSON.deserialize<T>(snapshot);
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
      const key = patch.key as string;
      const item = this.items.get(key);
      if (item) {
        if (!affectedItems.has(item)) {
          affectedItems.set(item, { oldVal: item.raw, patches: [] });
        }
        item.applyPatch(patch);
        affectedItems.get(item)!.patches.push(patch);
      }
    }
    for (const [item, data] of affectedItems.entries()) {
      item.triggerReactivity();
      item.bus.emit('update', item.raw, data.oldVal, data.patches);
    }
  }
}

export class SyncItemReceiver<T> {
  public readonly bus = new Nanobus<ReceiverItemBusDefinition<T>>('SyncItemReceiver');
  private value: T;
  private _ref: Ref<T> | null = null;
  private _shallowRef: ShallowRef<T> | null = null;

  constructor(
    public readonly key: string,
    initialValue: T,
  ) {
    this.value = initialValue;
  }

  public get raw(): Readonly<T> {
    return this.value;
  }

  public toRef(): Readonly<Ref<DeepReadonly<T>>> {
    if (!this._ref) {
      this._ref = ref(deepStructureClone(this.value)) as Ref<T>;
    }
    return readonly(this._ref);
  }

  public toShallowRef(): Readonly<ShallowRef<DeepReadonly<T>>> {
    if (!this._shallowRef) {
      this._shallowRef = shallowRef(this.value) as ShallowRef<T>;
    }
    return readonly(this._shallowRef);
  }

  public applyPatch(patch: Patch): void {
    if (patch.path.length === 0) {
      // Root level patch (e.g. key replacement)
      if (patch.op === 'set') {
        this.value = patch.value as T;
        if (this._ref) this._ref.value = patch.value as T;
        if (this._shallowRef) this._shallowRef.value = patch.value as T;
      }
      return;
    }

    // Nested patch
    const lastKey = patch.path[patch.path.length - 1] as string | number;

    if (patch.op === 'set') {
      const current = navigatePath(this.value, patch.path, 0, patch.path.length - 1);
      const refCurrent = navigatePath(
        this._ref ? this._ref.value : null,
        patch.path,
        0,
        patch.path.length - 1,
      );

      setValueAtPath(current, lastKey, patch.value);
      setValueAtPath(refCurrent, lastKey, patch.value);
    } else if (patch.op === 'delete') {
      const current = navigatePath(this.value, patch.path, 0, patch.path.length - 1);
      const refCurrent = navigatePath(
        this._ref ? this._ref.value : null,
        patch.path,
        0,
        patch.path.length - 1,
      );

      deleteValueAtPath(current, lastKey);
      deleteValueAtPath(refCurrent, lastKey);
    } else if (patch.op === 'add') {
      const target = navigatePath(this.value, patch.path, 0, patch.path.length);
      const refTarget = navigatePath(
        this._ref ? this._ref.value : null,
        patch.path,
        0,
        patch.path.length,
      );

      addValueToSet(target, patch.value);
      addValueToSet(refTarget, patch.value);
    } else if (patch.op === 'clear') {
      const target = navigatePath(this.value, patch.path, 0, patch.path.length);
      const refTarget = navigatePath(
        this._ref ? this._ref.value : null,
        patch.path,
        0,
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
  }
}
