-- Marketplace listings schema
CREATE TABLE listing (
  id           INTEGER PRIMARY KEY,
  seller_id    INTEGER NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  category     TEXT NOT NULL,
  posted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sold_at      TIMESTAMP
);

CREATE INDEX idx_listing_category ON listing(category);
CREATE INDEX idx_listing_seller   ON listing(seller_id);

INSERT INTO listing(seller_id, title, price_cents, category) VALUES
  (1, 'IBM PC AT 286 working', 15000, 'hardware'),
  (2, 'Mac SE/30 with extras', 22000, 'hardware'),
  (3, '1992 Honda CB750 motorcycle', 280000, 'vehicles');
