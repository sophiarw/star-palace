-- PC parts inventory
CREATE TABLE part (
  sku        TEXT PRIMARY KEY,
  vendor     TEXT NOT NULL,
  kind       TEXT CHECK (kind IN ('cpu','ram','disk','gpu','psu','board')),
  spec       TEXT,
  cost_cents INTEGER NOT NULL,
  stock      INTEGER NOT NULL DEFAULT 0
);

INSERT INTO part VALUES
  ('CPU-486DX2-66', 'Intel', 'cpu', '80486DX2 @ 66MHz', 18000, 3),
  ('RAM-4MB-72PIN', 'Kingston', 'ram', '4MB 72-pin SIMM', 4500, 12),
  ('HDD-540MB-IDE', 'Quantum', 'disk', '540MB Fireball IDE', 9000, 5);
