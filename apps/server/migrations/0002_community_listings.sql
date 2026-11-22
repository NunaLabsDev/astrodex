-- AstroDex D1 Schema (0002_community_listings.sql)
-- Adds community listing metadata and tiered review status without blocking instant publication.

ALTER TABLE dex_tokens ADD COLUMN name TEXT;
ALTER TABLE dex_tokens ADD COLUMN review_status TEXT NOT NULL DEFAULT 'verified';
ALTER TABLE dex_tokens ADD COLUMN review_note TEXT;
ALTER TABLE dex_tokens ADD COLUMN amm_venue TEXT;
ALTER TABLE dex_tokens ADD COLUMN pair_id TEXT;
ALTER TABLE dex_tokens ADD COLUMN community_url TEXT;
