#!/usr/bin/env bash
#
# Run Tiny Brains Service in development mode
#
# Usage (from afi-reactor root):
#   ./scripts/run_tiny_brains_dev.sh
#
# This script starts the Tiny Brains FastAPI service with uvicorn in reload mode.
# Service will be available at http://localhost:8090
#
# Prerequisites:
#   - Python 3.10+
#   - Dependencies installed: cd ../afi-tiny-brains && pip install -e .
#
# Note: Tiny Brains now lives in a separate repo folder (afi-tiny-brains)
#       at the workspace root, not inside afi-reactor.
#

set -e

# Get script directory and workspace root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AFI_REACTOR_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$AFI_REACTOR_ROOT/.." && pwd)"
SERVICE_DIR="$WORKSPACE_ROOT/afi-tiny-brains"

echo "🧠 Starting Tiny Brains Service..."
echo "📁 Service directory: $SERVICE_DIR"
echo ""

# Check if service directory exists
if [ ! -d "$SERVICE_DIR" ]; then
    echo "❌ Error: afi-tiny-brains directory not found at $SERVICE_DIR"
    echo "💡 Expected location: $WORKSPACE_ROOT/afi-tiny-brains"
    echo "💡 Make sure the afi-tiny-brains repo folder exists at the workspace root"
    exit 1
fi

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 not found. Please install Python 3.10+"
    exit 1
fi

# Set PYTHONPATH to include service directory
export PYTHONPATH="$SERVICE_DIR:$PYTHONPATH"

# Change to service directory
cd "$SERVICE_DIR"

# Check if dependencies are installed
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "⚠️  Warning: FastAPI not found. Installing dependencies..."
    pip install -e .
fi

# Run uvicorn with reload
echo "🚀 Starting uvicorn server..."
echo "📡 Service will be available at: http://localhost:8090"
echo "📊 Health check: http://localhost:8090/health"
echo "🔮 Prediction endpoint: http://localhost:8090/predict/froggy"
echo ""
echo "Press Ctrl+C to stop"
echo ""

uvicorn tiny_brains_service.service:app \
    --host 0.0.0.0 \
    --port 8090 \
    --reload \
    --log-level info

