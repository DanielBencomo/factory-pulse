#!/usr/bin/env sh
# Diagnóstico de sólo lectura. No crea eventos, latidos ni paros.
set -eu
api_base="${FP_API_TARGET:-http://127.0.0.1:8000}"
curl -fsS "$api_base/api/health"
curl -fsS "$api_base/api/cameras/profiles"
curl -fsS "$api_base/api/spatial/summary?scope=plant&minutes=15"
