-- CreateEnum
CREATE TYPE "failure_code" AS ENUM ('NO_AGENT_COMPLETED', 'WORKFLOW_ERROR', 'ENDED_UNRECORDED');

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "failure_code" "failure_code";
