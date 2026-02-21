import { shouldProxy } from './utils';
import type { Patch } from './types';

export function createDeepProxy<T>(
  target: T,
  rootKey: string,
  path: (string | number)[],
  onPatch: (patch: Patch) => void,
): T {
  if (!shouldProxy(target)) {
    return target;
  }

  if (target instanceof Map) {
    return createMapProxy(target, rootKey, path, onPatch) as T;
  }

  if (target instanceof Set) {
    return createSetProxy(target, rootKey, path, onPatch) as T;
  }

  return createObjectProxy(target as object, rootKey, path, onPatch) as T;
}

function createObjectProxy<T extends object>(
  target: T,
  rootKey: string,
  path: (string | number)[],
  onPatch: (patch: Patch) => void,
): T {
  const handler: ProxyHandler<T> = {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);

      if (typeof prop === 'symbol') {
        return value;
      }

      if (shouldProxy(value)) {
        return createDeepProxy(value, rootKey, [...path, prop], onPatch);
      }

      return value;
    },

    set(obj, prop, value, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.set(obj, prop, value, receiver);
      }

      const success = Reflect.set(obj, prop, value, receiver);
      if (success) {
        onPatch({
          op: 'set',
          key: rootKey,
          path: [...path, prop],
          value,
        });
      }
      return success;
    },

    deleteProperty(obj, prop) {
      if (typeof prop === 'symbol') {
        return Reflect.deleteProperty(obj, prop);
      }

      const success = Reflect.deleteProperty(obj, prop);
      if (success) {
        onPatch({
          op: 'delete',
          key: rootKey,
          path: [...path, prop],
        });
      }
      return success;
    },
  };

  return new Proxy(target, handler);
}

function createMapProxy<K, V>(
  target: Map<K, V>,
  rootKey: string,
  path: (string | number)[],
  onPatch: (patch: Patch) => void,
): Map<K, V> {
  const handler: ProxyHandler<Map<K, V>> = {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (typeof prop === 'symbol') {
        return typeof value === 'function' ? value.bind(obj) : value;
      }

      if (typeof value === 'function') {
        if (prop === 'set') {
          return function (key: K, val: V) {
            const result = obj.set(key, val);
            onPatch({
              op: 'set',
              key: rootKey,
              path: [...path, key as string | number],
              value: val,
            });
            return result;
          };
        }
        if (prop === 'delete') {
          return function (key: K) {
            const hasKey = obj.has(key);
            const result = obj.delete(key);
            if (hasKey) {
              onPatch({
                op: 'delete',
                key: rootKey,
                path: [...path, key as string | number],
              });
            }
            return result;
          };
        }
        if (prop === 'clear') {
          return function () {
            if (obj.size > 0) {
              const result = obj.clear();
              onPatch({
                op: 'clear',
                key: rootKey,
                path: path,
              });
              return result;
            }
          };
        }
        if (prop === 'get') {
          return function (key: K) {
            const getVal = obj.get(key);
            if (shouldProxy(getVal)) {
              return createDeepProxy(getVal, rootKey, [...path, key as string | number], onPatch);
            }
            return getVal;
          };
        }
        // bind other methods to original map (like has, keys, values, etc.)
        return value.bind(obj);
      }

      return value;
    },
  };

  return new Proxy(target, handler);
}

function createSetProxy<T>(
  target: Set<T>,
  rootKey: string,
  path: (string | number)[],
  onPatch: (patch: Patch) => void,
): Set<T> {
  const handler: ProxyHandler<Set<T>> = {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (typeof prop === 'symbol') {
        return typeof value === 'function' ? value.bind(obj) : value;
      }

      if (typeof value === 'function') {
        if (prop === 'add') {
          return function (val: T) {
            const hasVal = obj.has(val);
            const result = obj.add(val);
            if (!hasVal) {
              onPatch({
                op: 'add',
                key: rootKey,
                // For set, we don't have a key to navigate, but we can pass the value
                // In a true Sync scenario, Set diffing is tricky. Path is just the Set itself.
                path: path,
                value: val,
              });
            }
            return result;
          };
        }
        if (prop === 'delete') {
          return function (val: T) {
            const hasVal = obj.has(val);
            const result = obj.delete(val);
            if (hasVal) {
              onPatch({
                op: 'delete',
                key: rootKey,
                path: path, // Similarly, deleting from set happens at Set boundary
                value: val, // use value to identify what to delete
              });
            }
            return result;
          };
        }
        if (prop === 'clear') {
          return function () {
            if (obj.size > 0) {
              const result = obj.clear();
              onPatch({
                op: 'clear',
                key: rootKey,
                path: path,
              });
              return result;
            }
          };
        }

        // Return bindings for iterator functions
        return value.bind(obj);
      }
      return value;
    },
  };

  return new Proxy(target, handler);
}
