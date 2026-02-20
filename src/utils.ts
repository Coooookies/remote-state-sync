export function isObject(val: unknown): val is object {
  return val !== null && typeof val === 'object';
}

export function shouldProxy(val: unknown): boolean {
  if (!isObject(val)) return false;
  // Do not proxy functions, symbols, null, etc.
  if (typeof val === 'function') return false;
  if (val instanceof Date) return false;
  if (val instanceof RegExp) return false;
  return true;
}

export function navigatePath(
  obj: unknown,
  path: (string | number)[],
  startIdx: number,
  endIdx: number,
): unknown {
  let current: unknown = obj;
  for (let i = startIdx; i < endIdx; i++) {
    if (current === undefined || current === null) return current;
    const step = path[i];
    if (current instanceof Map) {
      current = current.get(step);
    } else {
      current = (current as Record<string, unknown>)[step as string];
    }
  }
  return current;
}

export function setValueAtPath(current: unknown, key: string | number, value: unknown): void {
  if (!current) return;
  if (current instanceof Map) {
    current.set(key, value);
  } else {
    (current as Record<string, unknown>)[key as string] = value;
  }
}

export function deleteValueAtPath(current: unknown, key: string | number): void {
  if (!current) return;
  if (current instanceof Map) {
    current.delete(key);
  } else {
    delete (current as Record<string, unknown>)[key as string];
  }
}

export function addValueToSet(current: unknown, value: unknown): void {
  if (current instanceof Set) {
    current.add(value);
  }
}

export function clearValue(current: unknown): void {
  if (current && typeof (current as Map<unknown, unknown>).clear === 'function') {
    (current as Map<unknown, unknown>).clear();
  }
}
