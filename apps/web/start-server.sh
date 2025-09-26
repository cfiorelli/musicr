#!/bin/sh

# Simple wrapper script to start serve and ignore any extra arguments
# Railway tends to append extra arguments that serve doesn't understand
# -s flag enables Single Page Application mode (rewrites 404s to index.html)

echo "Starting serve on 0.0.0.0:${PORT:-5173}"
exec pnpm exec serve -s dist -l 0.0.0.0:${PORT:-5173}