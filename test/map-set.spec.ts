import { describe, it, expect } from 'vitest';
import { SyncProvider, SyncReceiver } from '../src/index';

describe('Remote State Sync - Maps and Sets', () => {
  it('should sync Maps', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('map_ns');

    const map1 = test1.sync<Map<string, number>>('map', new Map([['a', 1]]));

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns) => provider.getStateSnapshot(ns),
    });

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
    });

    const test2 = await receiver.register('map_ns');
    const map2 = test2.sync<Map<string, number>>('map');

    expect(map2.toValue().get('a')).toBe(1);

    // object mutation test
    const val1 = map1.toValue();
    val1.set('b', 2);

    await new Promise((r) => setTimeout(r, 10));
    expect(map2.toValue().get('b')).toBe(2);

    val1.delete('a');
    await new Promise((r) => setTimeout(r, 10));
    expect(map2.toValue().has('a')).toBe(false);

    val1.clear();
    await new Promise((r) => setTimeout(r, 10));
    expect(map2.toValue().size).toBe(0);
  });

  it('should sync Sets', async () => {
    const provider = new SyncProvider();
    const test1 = provider.register('set_ns');

    const set1 = test1.sync<Set<number>>('set', new Set([1]));

    const receiver = new SyncReceiver({
      snapshotGetter: async (ns) => provider.getStateSnapshot(ns),
    });

    provider.bus.on('update', (ns, patches) => {
      receiver.applyPatches(ns, patches);
    });

    const test2 = await receiver.register('set_ns');
    const set2 = test2.sync<Set<number>>('set');

    expect(set2.toValue().has(1)).toBe(true);

    const val1 = set1.toValue();
    val1.add(2);

    await new Promise((r) => setTimeout(r, 10));
    expect(set2.toValue().has(2)).toBe(true);

    val1.delete(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(set2.toValue().has(1)).toBe(false);

    val1.clear();
    await new Promise((r) => setTimeout(r, 10));
    expect(set2.toValue().size).toBe(0);
  });
});
