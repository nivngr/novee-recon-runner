import { ActivityFailure, ApplicationFailure, TimeoutFailure } from '@temporalio/workflow';

/** The activity failed with our ApplicationFailure of this type (see activities/failure-types.ts). */
export function isFailureOfType(error: unknown, type: string): boolean {
  return (
    error instanceof ActivityFailure && error.cause instanceof ApplicationFailure && error.cause.type === type
  );
}

/** The activity ran out of time (e.g. schedule-to-close: retried for as long as it was allowed). */
export function isTimeout(error: unknown): boolean {
  return error instanceof ActivityFailure && error.cause instanceof TimeoutFailure;
}

/** The most useful message: an activity failure's own message is just "Activity task failed". */
export function describeFailure(error: Error): string {
  return error.cause instanceof Error ? error.cause.message : error.message;
}
