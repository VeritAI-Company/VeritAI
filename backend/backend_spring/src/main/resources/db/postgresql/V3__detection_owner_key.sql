ALTER TABLE detection_request
    ADD COLUMN IF NOT EXISTS owner_key_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_detection_request_owner
    ON detection_request (owner_key_hash);
