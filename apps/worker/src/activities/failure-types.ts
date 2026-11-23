// No imports: the workflow reads these names too, and workflow code can't import the activity runtime.

/** Failure types the workflow tells apart (ApplicationFailure.type). */
export const FailureType = {
  UnsupportedDomain: 'UnsupportedDomain',
  BadRequest: 'BadRequest',
  AgentServiceUnavailable: 'AgentServiceUnavailable',
  InjectedFailure: 'InjectedFailure',
} as const;
