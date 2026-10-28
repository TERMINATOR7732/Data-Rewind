#!/usr/bin/env bash
set -euo pipefail

echo "====================================================================="
echo " DATA REWIND -- Local-First Forensic Pipeline Workbench"
echo " Understand the past. Verify the present."
echo "====================================================================="

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] Python 3.11+ is required but not installed or not in PATH."
    exit 1
fi

# Check Node
if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js 20+ is required but not installed or not in PATH."
    exit 1
fi

# Activate virtualenv if present
if [ -d ".venv" ]; then
    echo "[INFO] Activating virtual environment..."
    # shellcheck disable=SC1091
    source .venv/bin/activate
fi

# Install frontend dependencies if needed
if [ ! -d "frontend/node_modules" ]; then
    echo "[INFO] Installing frontend dependencies..."
    (cd frontend && npm install)
fi

echo "[INFO] Starting Data Rewind API Backend on 127.0.0.1:8000..."
python3 -m data_rewind.cli serve --port 8000 &
BACKEND_PID=$!

echo "[INFO] Starting Frontend Workbench on port 5173..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true" EXIT

sleep 3

if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:5173" &>/dev/null || true
elif command -v open &>/dev/null; then
    open "http://localhost:5173" &>/dev/null || true
fi

echo "====================================================================="
echo " Data Rewind is running locally:"
echo " - Frontend UI:  http://localhost:5173"
echo " - API Docs:     http://127.0.0.1:8000/api/docs"
echo " - Healthcheck:  http://127.0.0.1:8000/api/v1/health"
echo "====================================================================="
echo " Press Ctrl+C to stop services."

wait
