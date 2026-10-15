-- Split tender: one ticket, many payments.
--
-- A ticket previously carried a single payment inline. Two people splitting a
-- bill is one ticket settled by several tenders, so payments become rows.
-- The columns on `tickets` are kept as a maintained summary (totals across all
-- tenders) so existing consumers and the paid-ticket CHECK still hold.

CREATE TABLE IF NOT EXISTS ticket_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id             UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  -- Device-minted idempotency key. Two identical tenders are legitimate, so a
  -- replay can only be recognised by key, never by matching amounts.
  client_payment_id     UUID,
  sequence              INTEGER NOT NULL,
  payment_method        payment_method NOT NULL,
  -- What the customer handed over.
  amount_tendered_cents INTEGER NOT NULL CHECK (amount_tendered_cents > 0),
  -- How much of it went against the balance; the rest is change.
  amount_applied_cents  INTEGER NOT NULL CHECK (amount_applied_cents > 0),
  change_due_cents      INTEGER NOT NULL CHECK (change_due_cents >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ticket_payments_change_consistent
    CHECK (change_due_cents = amount_tendered_cents - amount_applied_cents)
);

-- Replaying a tender must not record it twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_payments_client_payment_id
  ON ticket_payments(client_payment_id)
  WHERE client_payment_id IS NOT NULL;

-- Tenders are ordered within a ticket, and that order is unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_payments_sequence
  ON ticket_payments(ticket_id, sequence);

-- Tickets paid before this migration had exactly one tender, recorded inline.
-- Give them a payment row so every receipt reads the same way.
INSERT INTO ticket_payments (
  ticket_id, sequence, payment_method,
  amount_tendered_cents, amount_applied_cents, change_due_cents, created_at
)
SELECT
  t.id, 1, t.payment_method,
  t.amount_tendered_cents, t.total_cents, t.change_due_cents,
  COALESCE(t.paid_at, t.created_at)
FROM tickets t
WHERE t.status = 'paid'
  AND t.payment_method IS NOT NULL
  AND t.amount_tendered_cents IS NOT NULL
  AND t.change_due_cents IS NOT NULL
  AND t.total_cents > 0
  AND NOT EXISTS (SELECT 1 FROM ticket_payments p WHERE p.ticket_id = t.id);
