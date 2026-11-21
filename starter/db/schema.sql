-- Base schema for the Novee fullstack home task.
--
-- This is a STARTING POINT, not a specification. You own the schema — add columns,
-- indexes and constraints as your design needs. If you think something is missing here,
-- that is probably worth a line in NOTES.md.

-- One row per assessment a user submits.
CREATE TABLE IF NOT EXISTS assessments (
    id            UUID PRIMARY KEY,
    target_domain TEXT        NOT NULL,
    agent_count   INTEGER     NOT NULL,
    window_size   INTEGER     NOT NULL DEFAULT 2,
    status        TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessments_created_at_idx
    ON assessments (created_at DESC);

-- One row per agent an assessment runs.
--
-- This is what the UI's progress display reads: "4 of 10 agents completed". Whether you
-- write these rows as agents finish, or derive progress from live workflow state, or both,
-- is your call — R8 only requires that what the user sees is true.
--
-- Note what is NOT here. If the activity that records an agent gets retried, what stops a
-- second row appearing for the same agent?
CREATE TABLE IF NOT EXISTS assessment_agents (
    id            BIGSERIAL   PRIMARY KEY,
    assessment_id UUID        NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    agent_index   INTEGER     NOT NULL,
    technique     TEXT,
    scan_id       TEXT,
    status        TEXT        NOT NULL,
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS assessment_agents_assessment_idx
    ON assessment_agents (assessment_id);

-- The deduplicated union of everything the agents discovered.
--
-- Several agents will report the same subdomain — that is the point of running more than
-- one. We count rows in this table after a run whose activities were retried, and expect
-- to find each domain exactly once (R3).
CREATE TABLE IF NOT EXISTS discovered_domains (
    id            BIGSERIAL   PRIMARY KEY,
    assessment_id UUID        NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    domain        TEXT        NOT NULL,
    risk          TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovered_domains_assessment_idx
    ON discovered_domains (assessment_id);
