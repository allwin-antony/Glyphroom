#!/usr/bin/env bash
# ==============================================================================
# Enterprise Blogger 2.0 — Turnkey Production Deployment Script
# Single-command zero-dependency deployment for internal Linux servers.
# Requires ONLY Docker Engine 24+ and Docker Compose v2.
#
# Usage:
#   ./scripts/deploy.sh            # Deploy or update full stack
#   ./scripts/deploy.sh --status   # Check real-time service health
#   ./scripts/deploy.sh --stop     # Gracefully stop all services
#   ./scripts/deploy.sh --restart  # Rebuild and restart stack
#   ./scripts/deploy.sh --logs     # Tail live logs
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"

# ANSI Colors
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

log_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# ------------------------------------------------------------------------------
# 1. Host Prerequisite Validation
# ------------------------------------------------------------------------------
check_prerequisites() {
    log_info "Validating host prerequisites..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed on this host."
        echo "Please install Docker via: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        if ! command -v docker-compose &> /dev/null; then
            log_error "Docker Compose (v2) is not available."
            echo "Please ensure the Docker Compose plugin is installed."
            exit 1
        fi
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running or current user lacks docker group permissions."
        exit 1
    fi

    log_success "Host prerequisites satisfied (${COMPOSE_CMD})."
}

# ------------------------------------------------------------------------------
# 2. Environment Configuration & Secret Generation
# ------------------------------------------------------------------------------
setup_environment() {
    log_info "Checking environment configuration..."

    if [ ! -f "${ENV_FILE}" ]; then
        if [ -f "${ENV_EXAMPLE}" ]; then
            log_warn ".env not found. Bootstrapping from .env.example..."
            cp "${ENV_EXAMPLE}" "${ENV_FILE}"
        else
            log_error ".env and .env.example are missing. Cannot continue."
            exit 1
        fi
    fi

    # Helper function to generate cryptographically random 32-byte hex strings
    generate_secret() {
        if command -v openssl &> /dev/null; then
            openssl rand -hex 32
        else
            head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
        fi
    }

    # Auto-replace placeholder passwords/secrets with secure random values if untouched
    if grep -q "REPLACE_WITH_STRONG_PASSWORD_IN_PROD" "${ENV_FILE}" 2>/dev/null; then
        NEW_PG_PASS="$(generate_secret)"
        sed -i.bak "s/REPLACE_WITH_STRONG_PASSWORD_IN_PROD/${NEW_PG_PASS}/g" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
        log_success "Generated secure random POSTGRES_PASSWORD in .env."
    fi

    if grep -q "REPLACE_WITH_STRONG_GATEWAY_SECRET" "${ENV_FILE}" 2>/dev/null; then
        NEW_GW_SECRET="$(generate_secret)"
        sed -i.bak "s/REPLACE_WITH_STRONG_GATEWAY_SECRET/${NEW_GW_SECRET}/g" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
        log_success "Generated secure random GATEWAY_SECRET in .env."
    fi

    if grep -q "REPLACE_WITH_STRONG_JWT_SECRET" "${ENV_FILE}" 2>/dev/null; then
        NEW_JWT_SECRET="$(generate_secret)"
        sed -i.bak "s/REPLACE_WITH_STRONG_JWT_SECRET/${NEW_JWT_SECRET}/g" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
        log_success "Generated secure random JWT_SECRET in .env."
    fi

    if grep -q "REPLACE_WITH_STRONG_COOKIE_SECRET" "${ENV_FILE}" 2>/dev/null; then
        NEW_COOKIE_SECRET="$(generate_secret)"
        sed -i.bak "s/REPLACE_WITH_STRONG_COOKIE_SECRET/${NEW_COOKIE_SECRET}/g" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
        log_success "Generated secure random COOKIE_SECRET in .env."
    fi

    log_success "Environment configuration verified (${ENV_FILE})."
}

# ------------------------------------------------------------------------------
# 3. Persistent Storage Directory Preparation
# ------------------------------------------------------------------------------
prepare_storage() {
    log_info "Ensuring persistent storage directories exist..."

    mkdir -p "${ROOT_DIR}/data/postgres"
    mkdir -p "${ROOT_DIR}/data/attachments"
    mkdir -p "${ROOT_DIR}/data/logs/collab"
    mkdir -p "${ROOT_DIR}/data/logs/mcp"
    mkdir -p "${ROOT_DIR}/data/logs/audit"
    mkdir -p "${ROOT_DIR}/data/redis"
    mkdir -p "${ROOT_DIR}/docker/postgres"

    log_success "Storage volumes prepared."
}

# ------------------------------------------------------------------------------
# 4. Service Launch
# ------------------------------------------------------------------------------
deploy_services() {
    log_info "Building and launching Enterprise Blogger containers..."
    cd "${ROOT_DIR}"
    ${COMPOSE_CMD} -f "${COMPOSE_FILE}" up -d --build --remove-orphans
    log_success "Containers launched."
}

# ------------------------------------------------------------------------------
# 5. Health Check Verification
# ------------------------------------------------------------------------------
verify_health() {
    log_info "Waiting for services to become healthy..."
    local MAX_RETRIES=30
    local RETRY_COUNT=0
    local COLLAB_HEALTHY=false
    local MCP_HEALTHY=false

    while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
        RETRY_COUNT=$((RETRY_COUNT + 1))

        # Check Collab /healthz
        if ! ${COLLAB_HEALTHY}; then
            if curl -fs "http://127.0.0.1:4000/healthz" > /dev/null 2>&1; then
                COLLAB_HEALTHY=true
                log_success "Collab Engine is healthy (port 4000)."
            fi
        fi

        # Check MCP /healthz
        if ! ${MCP_HEALTHY}; then
            if curl -fs "http://127.0.0.1:5000/healthz" > /dev/null 2>&1; then
                MCP_HEALTHY=true
                log_success "MCP Server is healthy (port 5000)."
            fi
        fi

        if ${COLLAB_HEALTHY} && ${MCP_HEALTHY}; then
            break
        fi

        echo -n "."
        sleep 2
    done
    echo ""

    if ! ${COLLAB_HEALTHY} || ! ${MCP_HEALTHY}; then
        log_error "Health checks timed out after 60 seconds."
        log_warn "Recent container logs:"
        ${COMPOSE_CMD} -f "${COMPOSE_FILE}" logs --tail=40
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# 6. Operational Summary
# ------------------------------------------------------------------------------
show_summary() {
    echo ""
    echo -e "${BOLD}${GREEN}==============================================================================${NC}"
    echo -e "${BOLD}${GREEN}    Enterprise Blogger 2.0 — Production Deployment Successful!               ${NC}"
    echo -e "${BOLD}${GREEN}==============================================================================${NC}"
    echo ""
    echo -e "  ${BOLD}Collaboration WebSocket:${NC}  ws://127.0.0.1:4000"
    echo -e "  ${BOLD}Collab HTTP Gateway:${NC}      http://127.0.0.1:4000"
    echo -e "  ${BOLD}Collab Healthcheck:${NC}       http://127.0.0.1:4000/healthz"
    echo -e "  ${BOLD}MCP Agent Server:${NC}         http://127.0.0.1:5000"
    echo -e "  ${BOLD}MCP Healthcheck:${NC}          http://127.0.0.1:5000/healthz"
    echo -e "  ${BOLD}PostgreSQL 16:${NC}            127.0.0.1:5432 (Internal)"
    echo -e "  ${BOLD}Persistent Volumes:${NC}       ${ROOT_DIR}/data/"
    echo ""
    echo -e "${BOLD}Management Commands:${NC}"
    echo -e "  Check status:   ${CYAN}./scripts/deploy.sh --status${NC}"
    echo -e "  View logs:      ${CYAN}./scripts/deploy.sh --logs${NC}"
    echo -e "  Stop stack:     ${CYAN}./scripts/deploy.sh --stop${NC}"
    echo -e "  Restart stack:  ${CYAN}./scripts/deploy.sh --restart${NC}"
    echo -e "${BOLD}${GREEN}==============================================================================${NC}"
    echo ""
}

# ------------------------------------------------------------------------------
# CLI Flag Handling
# ------------------------------------------------------------------------------
case "${1:-}" in
    --status)
        check_prerequisites
        echo "=== Container Status ==="
        cd "${ROOT_DIR}" && ${COMPOSE_CMD} -f "${COMPOSE_FILE}" ps
        echo ""
        echo "=== Collab Healthz ==="
        curl -s "http://127.0.0.1:4000/healthz" || echo "Unreachable"
        echo ""
        echo "=== MCP Server Healthz ==="
        curl -s "http://127.0.0.1:5000/healthz" || echo "Unreachable"
        echo ""
        ;;
    --stop)
        check_prerequisites
        log_info "Stopping Enterprise Blogger containers gracefully..."
        cd "${ROOT_DIR}" && ${COMPOSE_CMD} -f "${COMPOSE_FILE}" down
        log_success "All containers stopped."
        ;;
    --restart)
        check_prerequisites
        setup_environment
        prepare_storage
        deploy_services
        verify_health
        show_summary
        ;;
    --logs)
        check_prerequisites
        cd "${ROOT_DIR}" && ${COMPOSE_CMD} -f "${COMPOSE_FILE}" logs -f --tail=100
        ;;
    --help|-h)
        echo "Usage: ./scripts/deploy.sh [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  (none)     Deploy and verify the full turnkey stack"
        echo "  --status   Inspect container status and query health endpoints"
        echo "  --stop     Stop all containers cleanly"
        echo "  --restart  Rebuild containers and redeploy"
        echo "  --logs     Follow consolidated log stream"
        echo "  --help     Show this help message"
        ;;
    *)
        check_prerequisites
        setup_environment
        prepare_storage
        deploy_services
        verify_health
        show_summary
        ;;
esac
