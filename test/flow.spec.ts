import { describe, it, expect } from 'vitest';
import { SyncProvider, SyncReceiver } from '../src/index';

describe('Remote State Sync', () => {
  it('should sync basic primitive types', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('test_namespace');

    const hi1 = test1.sync<number>('hi', 1);
    const str1 = test1.sync<string>('str', 'hello');
    const bool1 = test1.sync<boolean>('bool', true);

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns) => provider.getStateSnapshot(ns),
    });

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
    });

    const test2 = await receiver.register('test_namespace');
    const hi2 = test2.sync<number>('hi');
    const str2 = test2.sync<string>('str');
    const bool2 = test2.sync<boolean>('bool');

    expect(hi2.toValue()).toBe(1);
    expect(str2.toValue()).toBe('hello');
    expect(bool2.toValue()).toBe(true);

    hi1.set(2);
    str1.set('world');
    bool1.set(false);

    await new Promise((r) => setTimeout(r, 10)); // allow nanobus async emit

    expect(hi2.toValue()).toBe(2);
    expect(str2.toValue()).toBe('world');
    expect(bool2.toValue()).toBe(false);

    // Test updater function
    hi1.set((prev) => prev + 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(hi2.toValue()).toBe(3);
  });

  it('should sync objects', async () => {
    interface Hello {
      echo: string;
      deep?: { value: number };
    }
    const provider = new SyncProvider();
    const test1 = provider.register('obj_ns');

    const hello1 = test1.sync<Hello>('hello', { echo: 'world' });

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns) => provider.getStateSnapshot(ns),
    });

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
    });

    const test2 = await receiver.register('obj_ns');
    const hello2 = test2.sync<Hello>('hello');

    expect(hello2.toValue().echo).toBe('world');

    // object mutation test
    hello1.set((state) => {
      state.echo = 'world1';
      state.deep = { value: 42 };
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(hello2.toValue().echo).toBe('world1');
    expect(hello2.toValue().deep?.value).toBe(42);

    // proxy deep mutation test
    const val = hello1.toValue();
    if (val.deep) {
      val.deep.value = 43;
    }

    await new Promise((r) => setTimeout(r, 10));
    expect(hello2.toValue().deep?.value).toBe(43);

    // delete property
    hello1.set((state) => {
      delete state.deep;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(hello2.toValue().deep).toBeUndefined();
  });
});
