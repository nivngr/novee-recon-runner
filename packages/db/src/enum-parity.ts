import type * as Contracts from '@novee/contracts';
import type * as Db from './generated/prisma/enums.js';

// Compile-time proof that the database enums and the shared vocabulary list the same values.
// Adding a status to one side only fails `task check`, before anything is deployed.

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type EnumParity = [
  Assert<Same<Db.RiskLevel, Contracts.RiskLevel>>,
  Assert<Same<Db.AssessmentStatus, Contracts.AssessmentStatus>>,
  Assert<Same<Db.AgentStatus, Contracts.AgentStatus>>,
  Assert<Same<Db.LostReason, Contracts.LostReason>>,
  Assert<Same<Db.Decision, Contracts.Decision>>,
];
