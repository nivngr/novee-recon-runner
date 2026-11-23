import { describe, expect, it } from 'vitest';
import { classifyStartStatus, StartVerdict } from './classify.js';

describe('classifyStartStatus', () => {
  it.each([
    [202, StartVerdict.Started],
    [200, StartVerdict.Started],
    [422, StartVerdict.UnsupportedDomain],
    [400, StartVerdict.BadRequest],
    [503, StartVerdict.Retryable],
    [429, StartVerdict.Retryable],
    [500, StartVerdict.Retryable],
    [404, StartVerdict.Retryable],
  ])('%i → %s', (status, verdict) => {
    expect(classifyStartStatus(status)).toBe(verdict);
  });
});
