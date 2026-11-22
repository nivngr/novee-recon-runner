-- CreateEnum
CREATE TYPE "Risk" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "staged_discoveries" (
    "assessment_id" UUID NOT NULL,
    "agent_index" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "risk" "Risk" NOT NULL,

    CONSTRAINT "staged_discoveries_pkey" PRIMARY KEY ("assessment_id","agent_index","domain")
);

-- CreateTable
CREATE TABLE "discovered_domains" (
    "id" BIGSERIAL NOT NULL,
    "assessment_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "risk" "Risk" NOT NULL,

    CONSTRAINT "discovered_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discovered_domains_assessment_id_domain_key" ON "discovered_domains"("assessment_id", "domain");
