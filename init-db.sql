-- Database initialization script for musicr
-- This script sets up the database with pgvector extension

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify extension is installed
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- Create schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS public;

-- Grant necessary permissions
GRANT ALL ON SCHEMA public TO musicr;
GRANT ALL ON ALL TABLES IN SCHEMA public TO musicr;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO musicr;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO musicr;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO musicr;

-- Log successful initialization
DO $$
BEGIN
  RAISE NOTICE 'Database initialized successfully with pgvector extension';
END $$;