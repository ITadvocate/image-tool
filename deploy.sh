#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="${REPO_URL:-https://github.com/ITadvocate/image-tool.git}"
NETWORK_NAME="${COMPOSE_NETWORK_NAME:-image-tool-network}"
REQUIRED_FILES=("docker-compose.yml" "package.json" "server.js" "Dockerfile")

log() {
  printf '[image-tool] %s\n' "$1"
}

fail() {
  printf '[image-tool] ERROR: %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi

  if command_exists docker-compose; then
    echo "docker-compose"
    return
  fi

  fail "Docker Compose is not available on this machine."
}

has_required_files() {
  local file

  for file in "${REQUIRED_FILES[@]}"; do
    if [[ ! -f "${SCRIPT_DIR}/${file}" ]]; then
      return 1
    fi
  done

  return 0
}

sync_repo_into_place() {
  command_exists git || fail "git is required to fetch the project source."

  local temp_dir repo_dir
  temp_dir="$(mktemp -d)"
  repo_dir="${temp_dir}/repo"

  log "Local app files are missing. Fetching source from ${REPO_URL}"
  git clone --depth 1 "${REPO_URL}" "${repo_dir}" >/dev/null 2>&1 || fail "Unable to clone ${REPO_URL}"

  if command_exists rsync; then
    rsync -a \
      --exclude ".git" \
      --exclude ".github" \
      --exclude "node_modules" \
      --exclude "uploads" \
      --exclude "processed" \
      --exclude "temp" \
      "${repo_dir}/" "${SCRIPT_DIR}/"
  else
    cp -R "${repo_dir}/." "${SCRIPT_DIR}/"
    rm -rf "${SCRIPT_DIR}/.git" "${SCRIPT_DIR}/node_modules"
  fi

  rm -rf "${temp_dir}"
}

ensure_env_file() {
  if [[ ! -f "${SCRIPT_DIR}/.env" && -f "${SCRIPT_DIR}/.env.example" ]]; then
    cp "${SCRIPT_DIR}/.env.example" "${SCRIPT_DIR}/.env"
    log "Created .env from .env.example"
  fi
}

ensure_docker() {
  command_exists docker || fail "Docker is not installed."
  docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
}

ensure_network() {
  if docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    log "Docker network '${NETWORK_NAME}' already exists"
    return
  fi

  log "Creating Docker network '${NETWORK_NAME}'"
  docker network create "${NETWORK_NAME}" >/dev/null
}

launch_compose() {
  local compose
  compose="$(compose_cmd)"

  log "Starting application with ${compose}"
  (
    cd "${SCRIPT_DIR}"
    ${compose} up -d --build
  )
}

main() {
  if ! has_required_files; then
    sync_repo_into_place
  fi

  has_required_files || fail "Required application files are still missing after fetch."

  ensure_env_file
  ensure_docker
  ensure_network
  launch_compose

  log "Deployment complete"
  log "Open http://localhost:3000"
}

main "$@"
