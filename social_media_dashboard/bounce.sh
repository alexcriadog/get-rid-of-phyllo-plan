#!/usr/bin/env bash
# Free :4000 if anything is bound there.
set -e
P=$(lsof -ti :4000 2>/dev/null || true)
[ -n "$P" ] && kill -TERM "$P" || true
sleep 1
P=$(lsof -ti :4000 2>/dev/null || true)
[ -n "$P" ] && kill -KILL "$P" || true
sleep 1
echo "port: $(lsof -ti :4000 2>/dev/null || echo free)"
