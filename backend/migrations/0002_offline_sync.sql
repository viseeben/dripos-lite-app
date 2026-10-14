-- Offline support.
--
-- A till that takes cash with no connectivity has to replay those sales later,
-- and a replay must never create a second ticket or charge twice. The device
-- mints a UUID for each sale and sends it with every attempt; this column makes
-- that key authoritative at the database level, so even two concurrent syncs of
-- the same sale cannot both insert.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_ticket_id UUID;

-- Partial unique index: online tickets send no key, and NULLs must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_client_ticket_id
  ON tickets(client_ticket_id)
  WHERE client_ticket_id IS NOT NULL;

-- When the sale actually happened on the device, which can be long before it
-- reached us. Receipts and the ticket list must show the real time of sale.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS placed_at TIMESTAMPTZ;

-- The ticket list orders by time of sale, falling back to arrival time.
CREATE INDEX IF NOT EXISTS idx_tickets_placed_at
  ON tickets(COALESCE(placed_at, created_at) DESC);
