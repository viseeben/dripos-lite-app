-- Dripos Lite — initial schema.
-- Money is ALWAYS integer cents. No NUMERIC, no floats, anywhere.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CREATE TYPE has no IF NOT EXISTS; guard so the migration stays re-runnable.
DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash', 'card', 'gift_card', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modifier_groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id  TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  required     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_modifier_groups (
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  modifier_group_id UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, modifier_group_id)
);

CREATE TABLE IF NOT EXISTS modifier_options (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id       TEXT UNIQUE NOT NULL,
  modifier_group_id UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                ticket_status NOT NULL DEFAULT 'open',
  subtotal_cents        INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents             INTEGER NOT NULL CHECK (tax_cents >= 0),
  total_cents           INTEGER NOT NULL CHECK (total_cents >= 0),
  payment_method        payment_method,
  amount_tendered_cents INTEGER CHECK (amount_tendered_cents >= 0),
  change_due_cents      INTEGER CHECK (change_due_cents >= 0),
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id),
  product_name        TEXT NOT NULL,
  product_price_cents INTEGER NOT NULL,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents    INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents    INTEGER NOT NULL CHECK (line_total_cents >= 0),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_item_modifiers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_item_id       UUID NOT NULL REFERENCES ticket_items(id) ON DELETE CASCADE,
  modifier_option_id   UUID NOT NULL REFERENCES modifier_options(id),
  modifier_group_name  TEXT NOT NULL,
  modifier_option_name TEXT NOT NULL,
  price_delta_cents    INTEGER NOT NULL,
  sort_order           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket_id ON ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_item_modifiers_item_id ON ticket_item_modifiers(ticket_item_id);
CREATE INDEX IF NOT EXISTS idx_modifier_options_group_id ON modifier_options(modifier_group_id);
CREATE INDEX IF NOT EXISTS idx_pmg_product_id ON product_modifier_groups(product_id);

-- A paid ticket must carry a complete, self-consistent payment record.
DO $$ BEGIN
  ALTER TABLE tickets ADD CONSTRAINT tickets_paid_fields_complete CHECK (
    status <> 'paid' OR (
      payment_method IS NOT NULL
      AND amount_tendered_cents IS NOT NULL
      AND change_due_cents IS NOT NULL
      AND amount_tendered_cents >= total_cents
      AND change_due_cents = amount_tendered_cents - total_cents
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Totals must be internally consistent at the storage layer too.
DO $$ BEGIN
  ALTER TABLE tickets ADD CONSTRAINT tickets_total_is_subtotal_plus_tax
    CHECK (total_cents = subtotal_cents + tax_cents);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ticket_items ADD CONSTRAINT ticket_items_line_total_consistent
    CHECK (line_total_cents = unit_price_cents * quantity);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
