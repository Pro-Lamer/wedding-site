-- MVP initial schema for B2B marketplace service
-- PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
    CREATE TYPE company_status AS ENUM ('active', 'inactive', 'liquidated');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE verification_level AS ENUM ('L1_registry', 'L2_email_verified', 'L3_manual');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('company_admin', 'company_member', 'moderator', 'admin');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE post_type AS ENUM ('request', 'offer');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE post_status AS ENUM ('active', 'hidden', 'archived');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE response_status AS ENUM ('sent', 'viewed', 'replied', 'withdrawn');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE unlock_context_type AS ENUM ('company', 'post');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE unlock_type AS ENUM ('subscription', 'one_time');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE subscription_plan AS ENUM ('free', 'pro');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE subscription_status AS ENUM ('active', 'canceled', 'past_due');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('created', 'paid', 'failed', 'refunded');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE review_status AS ENUM ('pending', 'published', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE report_target_type AS ENUM ('company', 'post', 'response', 'review');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE report_status AS ENUM ('new', 'in_progress', 'resolved');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inn VARCHAR(12) NOT NULL UNIQUE,
    ogrn VARCHAR(15),
    kpp VARCHAR(9),
    name_full TEXT,
    name_short TEXT,
    status company_status NOT NULL DEFAULT 'active',
    legal_address TEXT,
    okved_main VARCHAR(16),
    okved_list JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT,
    website TEXT,
    region_code VARCHAR(16),
    verification_level verification_level NOT NULL DEFAULT 'L1_registry',
    contacts_email TEXT,
    contacts_phone TEXT,
    registry_last_checked_at TIMESTAMPTZ,
    registry_source TEXT,
    search_tsv tsvector,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_registry_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    source TEXT NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'company_admin',
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type post_type NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    budget_min NUMERIC(14, 2),
    budget_max NUMERIC(14, 2),
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    region_code VARCHAR(16),
    remote_flag BOOLEAN NOT NULL DEFAULT FALSE,
    deadline_date DATE,
    status post_status NOT NULL DEFAULT 'active',
    search_tsv tsvector,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    price NUMERIC(14, 2),
    timeline_days INTEGER,
    message TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    status response_status NOT NULL DEFAULT 'sent',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id, company_id)
);

CREATE TABLE IF NOT EXISTS response_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
    author_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    plan subscription_plan NOT NULL DEFAULT 'free',
    status subscription_status NOT NULL DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_payment_id TEXT,
    amount NUMERIC(14, 2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    status payment_status NOT NULL DEFAULT 'created',
    provider_event_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS contact_unlocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    target_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    context_type unlock_context_type NOT NULL,
    context_id UUID,
    unlock_type unlock_type NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    to_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_unlock_id UUID NOT NULL REFERENCES contact_unlocks(id) ON DELETE RESTRICT,
    rating_quality SMALLINT NOT NULL CHECK (rating_quality BETWEEN 1 AND 5),
    rating_timing SMALLINT NOT NULL CHECK (rating_timing BETWEEN 1 AND 5),
    rating_communication SMALLINT NOT NULL CHECK (rating_communication BETWEEN 1 AND 5),
    text TEXT,
    status review_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    target_type report_target_type NOT NULL,
    target_id UUID NOT NULL,
    reason TEXT NOT NULL,
    comment TEXT,
    status report_status NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moderator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    target_type report_target_type NOT NULL,
    target_id UUID NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id UUID,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Minimum indexes from spec
CREATE INDEX IF NOT EXISTS idx_companies_region_code ON companies(region_code);
CREATE INDEX IF NOT EXISTS idx_companies_verification_level ON companies(verification_level);

CREATE INDEX IF NOT EXISTS idx_posts_type_status ON posts(type, status);
CREATE INDEX IF NOT EXISTS idx_posts_category_id ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_region_code ON posts(region_code);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_responses_post_id ON responses(post_id);
CREATE INDEX IF NOT EXISTS idx_responses_company_id ON responses(company_id);

CREATE INDEX IF NOT EXISTS idx_contact_unlocks_requester_created_at
    ON contact_unlocks(requester_company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_unlocks_target_company_id
    ON contact_unlocks(target_company_id);

-- FTS indexes
CREATE INDEX IF NOT EXISTS idx_companies_search_tsv ON companies USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS idx_posts_search_tsv ON posts USING GIN(search_tsv);

-- Triggers to keep search vectors fresh
CREATE OR REPLACE FUNCTION companies_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        to_tsvector('russian', coalesce(NEW.name_full, '') || ' ' || coalesce(NEW.name_short, '') || ' ' || coalesce(NEW.description, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION posts_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        to_tsvector('russian', coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_search_tsv_update ON companies;
CREATE TRIGGER trg_companies_search_tsv_update
BEFORE INSERT OR UPDATE OF name_full, name_short, description ON companies
FOR EACH ROW EXECUTE FUNCTION companies_search_tsv_update();

DROP TRIGGER IF EXISTS trg_posts_search_tsv_update ON posts;
CREATE TRIGGER trg_posts_search_tsv_update
BEFORE INSERT OR UPDATE OF title, description ON posts
FOR EACH ROW EXECUTE FUNCTION posts_search_tsv_update();
