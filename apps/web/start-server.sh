#!/bin/sh

# Simple wrapper script to start serve and ignore any extra arguments
# Railway tends to append extra arguments that serve doesn't understand
# Try using environment variables to force binding to all interfaces

echo "Starting serve on 0.0.0.0:${PORT:-5173}"
export HOST=0.0.0.0
exec pnpm exec serve -s dist -p ${PORT:-5173}