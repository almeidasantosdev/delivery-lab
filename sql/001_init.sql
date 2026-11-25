CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_status_check CHECK (status IN ('accepted', 'delivered', 'failed'))
);

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  webhook_event_id BIGINT NOT NULL UNIQUE REFERENCES webhook_events (id),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  fail_until_attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delivery_jobs_status_check CHECK (status IN ('pending', 'processing', 'delivered', 'failed'))
);

CREATE INDEX IF NOT EXISTS delivery_jobs_due_idx
  ON delivery_jobs (next_attempt_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL UNIQUE REFERENCES delivery_jobs (id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  CONSTRAINT outbox_status_check CHECK (status IN ('pending', 'published'))
);

CREATE INDEX IF NOT EXISTS outbox_pending_idx
  ON outbox (id)
  WHERE status = 'pending';
