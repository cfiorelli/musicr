#!/bin/sh

# Simple wrapper script to start serve and ignore any extra arguments
# Railway tends to append extra arguments that serve doesn't understand

exec pnpm exec serve -s dist -l tcp://0.0.0.0:${PORT:-5173}