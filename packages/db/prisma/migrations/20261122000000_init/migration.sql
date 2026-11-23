-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "assessment_status" AS ENUM ('STARTING', 'RUNNING', 'AGGREGATING', 'AWAITING_APPROVAL', 'PERSISTING', 'COMPLETED', 'REJECTED', 'REJECTED_INPUT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "agent_status" AS ENUM ('QUEUED', 'STARTING', 'RUNNING', 'COMPLETED', 'FAILED', 'LOST', 'STOPPED');

-- CreateEnum
CREATE TYPE "lost_reason" AS ENUM ('START_FAILED', 'NOT_FOUND', 'NO_PROGRESS', 'CEILING');

-- CreateEnum
CREATE TYPE "decision" AS ENUM ('APPROVE', 'REJECT');

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "target_domain" TEXT NOT NULL,
    "agent_count" INTEGER NOT NULL,
    "window_size" INTEGER NOT NULL DEFAULT 2,
    "status" "assessment_status" NOT NULL DEFAULT 'STARTING',
    "stall_timeout_s" INTEGER NOT NULL DEFAULT 60,
    "max_agent_duration_s" INTEGER NOT NULL DEFAULT 300,
    "fail_first_attempts" INTEGER NOT NULL DEFAULT 0,
    "cancel_requested_at" TIMESTAMPTZ,
    "decision" "decision",
    "decision_requested_at" TIMESTAMPTZ,
    "unique_domains" INTEGER,
    "critical_count" INTEGER,
    "high_count" INTEGER,
    "medium_count" INTEGER,
    "low_count" INTEGER,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_agents" (
    "id" BIGSERIAL NOT NULL,
    "assessment_id" UUID NOT NULL,
    "agent_index" INTEGER NOT NULL,
    "technique" TEXT NOT NULL,
    "scan_id" TEXT,
    "status" "agent_status" NOT NULL DEFAULT 'QUEUED',
    "lost_reason" "lost_reason",
    "stop_confirmed" BOOLEAN,
    "progress" REAL NOT NULL DEFAULT 0,
    "discovered_count" INTEGER,
    "worker" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staged_discoveries" (
    "assessment_id" UUID NOT NULL,
    "agent_index" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "risk" "risk_level" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staged_discoveries_pkey" PRIMARY KEY ("assessment_id","agent_index","domain")
);

-- CreateTable
CREATE TABLE "discovered_domains" (
    "id" BIGSERIAL NOT NULL,
    "assessment_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "risk" "risk_level" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovered_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessments_created_at_idx" ON "assessments"("created_at" DESC);

-- CreateIndex
CREATE INDEX "assessment_agents_assessment_idx" ON "assessment_agents"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_agents_assessment_id_agent_index_key" ON "assessment_agents"("assessment_id", "agent_index");

-- CreateIndex
CREATE INDEX "discovered_domains_assessment_idx" ON "discovered_domains"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_domains_assessment_id_domain_key" ON "discovered_domains"("assessment_id", "domain");

-- AddForeignKey
ALTER TABLE "assessment_agents" ADD CONSTRAINT "assessment_agents_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staged_discoveries" ADD CONSTRAINT "staged_discoveries_assessment_id_agent_index_fkey" FOREIGN KEY ("assessment_id", "agent_index") REFERENCES "assessment_agents"("assessment_id", "agent_index") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_domains" ADD CONSTRAINT "discovered_domains_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: value ranges Prisma's schema language can't express (plan §2, §6). The API validates the
-- same limits; these make a bad write impossible, whoever writes it.
ALTER TABLE "assessments"
    ADD CONSTRAINT "assessments_agent_count_check" CHECK ("agent_count" BETWEEN 1 AND 20),
    ADD CONSTRAINT "assessments_window_size_check" CHECK ("window_size" BETWEEN 1 AND "agent_count"),
    ADD CONSTRAINT "assessments_fail_first_attempts_check" CHECK ("fail_first_attempts" BETWEEN 0 AND 5),
    ADD CONSTRAINT "assessments_stall_timeout_s_check" CHECK ("stall_timeout_s" BETWEEN 10 AND 600),
    ADD CONSTRAINT "assessments_max_agent_duration_s_check" CHECK ("max_agent_duration_s" BETWEEN 30 AND 3600);

ALTER TABLE "assessment_agents"
    ADD CONSTRAINT "assessment_agents_agent_index_check" CHECK ("agent_index" >= 0),
    ADD CONSTRAINT "assessment_agents_progress_check" CHECK ("progress" BETWEEN 0 AND 1);
