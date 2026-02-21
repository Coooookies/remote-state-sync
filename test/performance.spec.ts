import { describe, it, expect } from 'vitest';
import { SyncProvider, SyncReceiver } from '../src/index';

describe('Performance Tests (Extreme Conditions)', () => {
  it('Super Long Map - 100,000 items', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('perf_map');

    const map = new Map<number, string>();
    for (let i = 0; i < 100000; i++) {
      map.set(i, 'val' + i);
    }

    // Measuring initial setup and proxy wrapping
    const startSetup = performance.now();
    const val1 = test1.sync<Map<number, string>>('map', map);

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns, key) => provider.getStateSnapshot(ns, key),
    });

    let resolveUpdate!: () => void;
    const promise = new Promise<void>((r) => (resolveUpdate = r));

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
      resolveUpdate();
    });

    const test2 = await receiver.register('perf_map');
    const val2 = await test2.sync<Map<number, string>>('map');

    const setupTime = performance.now() - startSetup;

    // Measuring mutation speed
    const startMutate = performance.now();
    const proxyMap = val1.raw;
    for (let i = 0; i < 1000; i++) {
      proxyMap.set(i, 'newval' + i);
    }
    await promise; // wait for batch patch propagation
    const mutateTime = performance.now() - startMutate;

    console.log(
      `[Performance] Map(100,000): Setup/Proxy wrapping took ${setupTime.toFixed(2)}ms, Mutating 1000 items and syncing took ${mutateTime.toFixed(2)}ms`,
    );
    expect(val2.raw.get(999)).toBe('newval999');
  });

  it('Super Long Array - 100,000 items', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('perf_arr');
    const arr = new Array(100000).fill(0).map((_, i) => i);

    const startSetup = performance.now();
    const val1 = test1.sync('arr', arr);

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns, key) => provider.getStateSnapshot(ns, key),
    });

    let resolveUpdate!: () => void;
    const promise = new Promise<void>((r) => (resolveUpdate = r));

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
      resolveUpdate();
    });

    const test2 = await receiver.register('perf_arr');
    const val2 = await test2.sync<number[]>('arr');
    const setupTime = performance.now() - startSetup;

    const startMutate = performance.now();
    // Modify 1000 items in place
    // const proxyArr = val1.raw;
    // for (let i = 0; i < 1000; i++) {
    //   proxyArr[i] = proxyArr[i] + 1;
    // }
    val1.set((arr) => {
      for (let i = 0; i < 1000; i++) {
        arr[i] = arr[i] + 1;
      }
    });
    await promise; // wait for batch patch propagation
    const mutateTime = performance.now() - startMutate;

    console.log(
      `[Performance] Array(100,000): Setup took ${setupTime.toFixed(2)}ms, Mutating 1000 elements and syncing took ${mutateTime.toFixed(2)}ms`,
    );
    expect(val2.raw[0]).toBe(1);
    expect(val2.raw.length).toBe(100000);
  });

  it('Super Many Fields Object - 100,000 keys', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('perf_obj');
    const obj: Record<string, number> = {};
    for (let i = 0; i < 100000; i++) {
      obj['key' + i] = i;
    }

    const startSetup = performance.now();
    const val1 = test1.sync('obj', obj);

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns, key) => provider.getStateSnapshot(ns, key),
    });

    let resolveUpdate!: () => void;
    const promise = new Promise<void>((r) => (resolveUpdate = r));

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
      resolveUpdate();
    });

    const test2 = await receiver.register('perf_obj');
    const val2 = await test2.sync<Record<string, number>>('obj');
    const setupTime = performance.now() - startSetup;

    const startMutate = performance.now();
    // const proxyObj = val1.raw;
    // for (let i = 0; i < 1000; i++) {
    //   proxyObj['key' + i] = proxyObj['key' + i] + 1;
    // }
    val1.set((obj) => {
      for (let i = 0; i < 1000; i++) {
        obj['key' + i] = obj['key' + i] + 1;
      }
    });
    await promise;
    const mutateTime = performance.now() - startMutate;

    console.log(
      `[Performance] Object(100,000 keys): Setup took ${setupTime.toFixed(2)}ms, Mutating 1000 keys and syncing took ${mutateTime.toFixed(2)}ms`,
    );
    expect(val2.raw['key0']).toBe(1);
  });

  it('Super Deep Scenario - 1,000 levels nested object', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('perf_deep');

    // Create an object that is 1000 levels deep
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root: Record<string, any> = { value: 0 };
    let current = root;
    for (let i = 0; i < 1000; i++) {
      current.child = { value: i };
      current = current.child;
    }

    const startSetup = performance.now();
    const val1 = test1.sync('deep', root);

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns, key) => provider.getStateSnapshot(ns, key),
    });

    let resolveUpdate!: () => void;
    const promise = new Promise<void>((r) => (resolveUpdate = r));

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
      resolveUpdate();
    });

    const test2 = await receiver.register('perf_deep');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val2 = await test2.sync<Record<string, any>>('deep');
    const setupTime = performance.now() - startSetup;

    const startMutate = performance.now();

    // let proxyCurrent = val1.raw;
    // for (let i = 0; i < 1000; i++) {
    //   proxyCurrent = proxyCurrent.child; // Navigates the proxy, which will recursively create deep proxies down to level 1000 on the fly
    // }
    // proxyCurrent.value = 9999;
    val1.set((obj) => {
      let current = obj;
      for (let i = 0; i < 1000; i++) {
        current = current.child;
      }
      current.value = 9999;
    });

    await promise;
    const mutateTime = performance.now() - startMutate;

    console.log(
      `[Performance] Deep Object(1,000 levels): Setup took ${setupTime.toFixed(2)}ms, Navigating to level 1000, mutating and syncing took ${mutateTime.toFixed(2)}ms`,
    );

    let receiverCurrent = val2.raw;
    for (let i = 0; i < 1000; i++) {
      receiverCurrent = receiverCurrent.child;
    }
    expect(receiverCurrent.value).toBe(9999);
  });
});
