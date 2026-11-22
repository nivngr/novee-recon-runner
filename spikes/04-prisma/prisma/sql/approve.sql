-- @param {String} $1:assessmentId
INSERT INTO discovered_domains (assessment_id, domain, risk)
SELECT assessment_id, domain, max(risk)
FROM staged_discoveries
WHERE assessment_id = $1::uuid
GROUP BY assessment_id, domain
ON CONFLICT (assessment_id, domain) DO NOTHING
