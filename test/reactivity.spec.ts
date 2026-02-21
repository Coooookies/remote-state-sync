import { describe, it, expect } from 'vitest';
import { SyncProvider, SyncReceiver } from '../src/index';
// Testing vue reactivity by checking effect execution
import { effect } from '@vue/reactivity';

describe('Remote State Sync - Reactivity', () => {
  it('should trigger reactivity properly for Refs', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('vue_ns');

    const hi1 = test1.sync<number>('hi', 1);
    const obj1 = test1.sync<{ count: number }>('obj', { count: 0 });

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns, key) => provider.getStateSnapshot(ns, key),
    });

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
    });

    const test2 = await receiver.register('vue_ns');
    const hi2 = await test2.sync<number>('hi');
    const obj2 = await test2.sync<{ count: number }>('obj');

    let primitiveRuns = 0;
    let pval = 0;
    effect(() => {
      pval = hi2.toRef().value;
      primitiveRuns++;
    });

    let shallowObjRuns = 0;
    let objval = 0;
    effect(() => {
      objval = obj2.toShallowRef().value.count;
      shallowObjRuns++;
    });

    expect(primitiveRuns).toBe(1);
    expect(pval).toBe(1);
    expect(shallowObjRuns).toBe(1);
    expect(objval).toBe(0);

    hi1.set(2);
    obj1.set((state) => {
      state.count = 1;
    });

    await new Promise((r) => setTimeout(r, 10));

    // It should have triggered effect
    expect(primitiveRuns).toBe(2);
    expect(pval).toBe(2);

    // shallow ref + triggerRef triggers the whole ref to re-evaluate dependencies.
    // Setting `obj1.raw.count` is 2 operations internally (get + set) and our patches
    // trigger triggerReactivity() multiple times based on patches applied. Just ensure it ran
    // at least twice.
    expect(shallowObjRuns).toBeGreaterThanOrEqual(2);
    expect(objval).toBe(1);
  });
});
