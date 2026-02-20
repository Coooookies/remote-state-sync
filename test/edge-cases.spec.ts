import { describe, it, expect } from 'vitest';
import { SyncProvider, SyncReceiver } from '../src/index';

describe('Remote State Sync - Edge Cases', () => {
  it('should handle rapid consecutive patches via batching', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('rapid_ns');
    const val1 = test1.sync<number>('val', 0);

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns) => provider.getStateSnapshot(ns),
    });

    let updateCalls = 0;
    provider.bus.on('update', (ns, patches) => {
      updateCalls++;
      receiver.applyPatches(ns, patches);
    });

    const test2 = await receiver.register('rapid_ns');
    const val2 = test2.sync<number>('val');

    // rapid synchronous mutations loop
    for (let i = 1; i <= 1000; i++) {
      val1.set(i);
    }

    // Allow async Nanobus event to clear the timeout
    await new Promise((r) => setTimeout(r, 10));

    // It should have been batched into a single (or very few depending on event loop) emit
    expect(updateCalls).toBe(1);
    expect(val2.toValue()).toBe(1000);
  });

  it('should handle Arrays as objects natively', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('array_ns');
    const arr1 = test1.sync<number[]>('arr', [1, 2, 3]);

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns) => provider.getStateSnapshot(ns),
    });
    provider.bus.on('update', (ns, patches) => receiver.applyPatches(ns, patches));

    const test2 = await receiver.register('array_ns');
    const arr2 = test2.sync<number[]>('arr');

    const targetArr = arr1.toValue();
    targetArr.push(4); // proxy triggers: get push, get length, set 3 -> 4, set length -> 4

    await new Promise((r) => setTimeout(r, 10));

    expect(arr2.toValue().length).toBe(4);
    expect(arr2.toValue()[3]).toBe(4);

    targetArr.splice(1, 1); // remove index 1

    await new Promise((r) => setTimeout(r, 10));
    expect(arr2.toValue().length).toBe(3);
    expect(arr2.toValue()).toEqual([1, 3, 4]);
  });

  it('should safely handle Map inside Set inside Object', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('nested_complex_ns');

    type ComplexState = { items: Set<Map<string, number>> };
    const initialState: ComplexState = { items: new Set() };
    initialState.items.add(new Map([['a', 1]]));

    const complex1 = test1.sync<ComplexState>('state', initialState);

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns) => provider.getStateSnapshot(ns),
    });
    provider.bus.on('update', (ns, patches) => receiver.applyPatches(ns, patches));

    const test2 = await receiver.register('nested_complex_ns');
    const complex2 = test2.sync<ComplexState>('state');

    // get the map inside the set inside the object
    const val1 = complex1.toValue();
    const innerSet = val1.items;

    // iterate set to get the map proxy
    let innerMap!: Map<string, number>;
    for (const m of innerSet) {
      innerMap = m;
    }

    innerMap.set('b', 2);

    await new Promise((r) => setTimeout(r, 10));

    let receiverMap!: Map<string, unknown>;
    for (const m of complex2.toValue().items as unknown as Set<Map<string, unknown>>) {
      receiverMap = m;
    }

    expect(receiverMap.get('b')).toBe(2);
  });

  it('should safely ignore unproxyable types natively like Date and RegExp', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('unproxyable_ns');

    type Data = { date: Date; rx: RegExp };

    const dateObj = new Date();
    const data1 = test1.sync<Data>('data', { date: dateObj, rx: /test/g });

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns) => provider.getStateSnapshot(ns),
    });
    provider.bus.on('update', (ns, patches) => receiver.applyPatches(ns, patches));

    const test2 = await receiver.register('unproxyable_ns');
    const data2 = test2.sync<Data>('data');

    // These should be completely passed by reference because shouldProxy returned false
    // Mutating a date will not trigger patches
    const val1 = data1.toValue();
    val1.date.setFullYear(2050);

    // Wait. Since Date is passed by ref in snapshot sharing memory, the date will be mutated for receiver too,
    // but no proxy event is fired.

    // Let's replace the reference instead
    val1.rx = /new/g;

    await new Promise((r) => setTimeout(r, 10));
    expect(data2.toValue().rx.source).toBe('new');
  });
});
