-- Apply before deploying the matching application version when production uses
-- spring.jpa.hibernate.ddl-auto=validate. Existing rows remain compatible.
ALTER TABLE detection_request ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(64);
ALTER TABLE detection_request ADD COLUMN IF NOT EXISTS model_version VARCHAR(64);
ALTER TABLE detection_request ADD COLUMN IF NOT EXISTS pipeline_version VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uk_detection_request_dedup
    ON detection_request (dedup_key);
CREATE INDEX IF NOT EXISTS idx_detection_request_status_created
    ON detection_request (status, created_at);
CREATE INDEX IF NOT EXISTS idx_detection_request_status_updated
    ON detection_request (status, updated_at);
