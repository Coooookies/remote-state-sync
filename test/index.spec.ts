import { describe, it, expect } from 'vitest';
import { hello } from '../src/index';

describe('index', () => {
  it('should return a greeting message with the provided name', () => {
    const result = hello('Vitest');
    expect(result).toBe('Hello, Vitest! This is an ESM library.');
  });
});
