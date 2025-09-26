#!/bin/sh

# Simple wrapper script to start serve and ignore any extra arguments
# Railway tends to append extra arguments that serve doesn't understand
# -s flag enables Single Page Application mode (rewrites 404s to index.html)
# -p flag specifies port (serve will bind to 0.0.0.0 by default)

echo "Starting serve on port ${PORT:-5173}"
exec pnpm exec serve -s dist -p ${PORT:-5173}