import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import { FailureType } from './failure-types.js';

/**
 * The R3 retry switch (D15): on attempts 1..failFirstAttempts, fail *after* the side effect, as if the worker
 * died before reporting success. The retry must then find the work already done and change nothing.
 */
export function failIfInjected(failFirstAttempts: number): void {
  const { attempt, activityType } = Context.current().info;
  if (attempt <= failFirstAttempts) {
    throw ApplicationFailure.retryable(
      `${activityType}: injected failure on attempt ${attempt} of ${failFirstAttempts}`,
      FailureType.InjectedFailure,
    );
  }
}
