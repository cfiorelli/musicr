#!/bin/bash
# Setup local PostgreSQL for development

# Create database and user for development
echo "Setting up PostgreSQL database for Musicr..."

# Check if PostgreSQL is running
if ! command -v psql &> /dev/null; then
    echo "PostgreSQL is not installed. Please install it first:"
    echo "  macOS: brew install postgresql"
    echo "  Ubuntu: sudo apt-get install postgresql postgresql-contrib"
    exit 1
fi

# Start PostgreSQL service (if needed)
brew services start postgresql 2>/dev/null || true

# Create database and user
psql postgres -c "CREATE USER musicr WITH PASSWORD 'musicr';" 2>/dev/null || echo "User 'musicr' already exists"
psql postgres -c "CREATE DATABASE musicr OWNER musicr;" 2>/dev/null || echo "Database 'musicr' already exists"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE musicr TO musicr;" 2>/dev/null

echo "✅ PostgreSQL setup complete!"
echo "Database: musicr"
echo "User: musicr"
echo "Password: musicr"
echo "Connection string: postgresql://musicr:musicr@localhost:5432/musicr?schema=public"