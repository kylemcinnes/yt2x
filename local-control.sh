#!/usr/bin/env bash
# Local control script for yt2x service
# Usage: ./local-control.sh [start|stop|logs|status|restart|force-check]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "${1:-help}" in
  start)
    echo "🚀 Starting yt2x service..."
    docker compose up -d --build
    echo "✅ Service started. Check status with: ./local-control.sh status"
    ;;
  stop)
    echo "🛑 Stopping yt2x service..."
    docker compose down
    echo "✅ Service stopped"
    ;;
  restart)
    echo "🔄 Restarting yt2x service..."
    docker compose down
    docker compose up -d --build
    echo "✅ Service restarted"
    ;;
  logs)
    echo "📋 Following yt2x logs (Ctrl+C to exit)..."
    docker compose logs -f
    ;;
  status)
    echo "📊 yt2x service status:"
    docker compose ps
    echo ""
    echo "📋 Recent logs:"
    docker compose logs --tail=20
    ;;
  force-check)
    echo "🔍 Forcing re-check of most recent video..."
    docker compose exec yt2x rm -f /var/lib/yt2x/last.txt 2>/dev/null || echo "Container not running, starting service first..."
    docker compose up -d --build
    echo "✅ Service will now check for new videos on next poll cycle"
    ;;
  help|*)
    echo "yt2x Local Control Script"
    echo ""
    echo "Usage: ./local-control.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start        - Start the service (with auto-restart)"
    echo "  stop         - Stop the service"
    echo "  restart      - Restart the service"
    echo "  logs         - Follow logs in real-time"
    echo "  status       - Show service status and recent logs"
    echo "  force-check  - Force re-check for new videos"
    echo "  help         - Show this help message"
    echo ""
    echo "Auto-start setup:"
    echo "  1. Enable Docker Desktop auto-start: Docker Desktop → Settings → General → 'Start Docker Desktop when you log in'"
    echo "  2. Add ~/bin/start-yt2x.sh to Login Items: System Preferences → Users & Groups → Login Items"
    echo ""
    echo "Current status:"
    docker compose ps 2>/dev/null || echo "Service not running"
    ;;
esac
