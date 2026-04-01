#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="${REPO_URL:-https://github.com/ITadvocate/image-tool.git}"
APP_GIT_REF="${APP_GIT_REF:-develop}"
COMPOSE_NETWORK_NAME="${COMPOSE_NETWORK_NAME:-image-tool-network}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/health}"
HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-180}"
REQUIRED_FILES=("docker-compose.yml" "package.json" "server.js" "Dockerfile" "deploy.sh")

log() {
  printf '[publish-vm] %s\n' "$1"
}

fail() {
  printf '[publish-vm] ERROR: %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_linux() {
  [[ "$(uname -s)" == "Linux" ]] || fail "This script targets Linux VMs only."
}

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    command_exists sudo || fail "Run as root or install sudo."
    log "Re-running with sudo"
    exec sudo -E bash "$0" "$@"
  fi
}

pkg_manager() {
  if command_exists apt-get; then
    echo "apt"
    return
  fi

  if command_exists dnf; then
    echo "dnf"
    return
  fi

  if command_exists yum; then
    echo "yum"
    return
  fi

  fail "Supported package manager not found. Expected apt, dnf, or yum."
}

ensure_base_packages() {
  local manager
  manager="$(pkg_manager)"

  case "${manager}" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y ca-certificates curl git gnupg lsb-release rsync
      ;;
    dnf)
      dnf install -y ca-certificates curl git gnupg2 rsync
      ;;
    yum)
      yum install -y ca-certificates curl git gnupg2 rsync
      ;;
  esac
}

docker_ready() {
  command_exists docker && docker info >/dev/null 2>&1
}

install_docker() {
  local manager arch os_id codename repo_url
  manager="$(pkg_manager)"

  if docker_ready; then
    return
  fi

  log "Installing Docker and Docker Compose plugin"
  case "${manager}" in
    apt)
      arch="$(dpkg --print-architecture)"
      os_id="$(. /etc/os-release && echo "${ID}")"
      codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
      [[ -n "${codename}" ]] || fail "Unable to detect Linux codename for Docker repo setup."

      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/${os_id}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      repo_url="deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${os_id} ${codename} stable"
      printf '%s\n' "${repo_url}" >/etc/apt/sources.list.d/docker.list
      apt-get update -y
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    dnf)
      dnf -y install dnf-plugins-core
      dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    yum)
      yum install -y yum-utils
      yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
  esac

  systemctl enable --now docker
}

wait_for_docker() {
  local start now
  start="$(date +%s)"

  until docker_ready; do
    now="$(date +%s)"
    if (( now - start > 120 )); then
      fail "Docker daemon did not become ready in time."
    fi
    sleep 2
  done
}

has_required_files() {
  local file

  for file in "${REQUIRED_FILES[@]}"; do
    [[ -f "${SCRIPT_DIR}/${file}" ]] || return 1
  done

  return 0
}

sync_repo_into_place() {
  local temp_dir repo_dir
  temp_dir="$(mktemp -d)"
  repo_dir="${temp_dir}/repo"

  log "Fetching ${REPO_URL} (${APP_GIT_REF}) into ${SCRIPT_DIR}"
  git clone --depth 1 --branch "${APP_GIT_REF}" "${REPO_URL}" "${repo_dir}"

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

ensure_source_tree() {
  has_required_files && return
  sync_repo_into_place
  has_required_files || fail "Application files are still missing after clone."
}

wait_for_healthcheck() {
  local start now
  start="$(date +%s)"

  until curl -fsS "${HEALTHCHECK_URL}" >/dev/null 2>&1; do
    now="$(date +%s)"
    if (( now - start > HEALTHCHECK_TIMEOUT_SECONDS )); then
      fail "Health check timed out: ${HEALTHCHECK_URL}"
    fi
    sleep 3
  done
}

main() {
  require_linux
  need_root "$@"
  ensure_base_packages
  install_docker
  wait_for_docker
  ensure_source_tree

  log "Running compose deployment from ${SCRIPT_DIR}"
  APP_GIT_REF="${APP_GIT_REF}" \
  REPO_URL="${REPO_URL}" \
  COMPOSE_NETWORK_NAME="${COMPOSE_NETWORK_NAME}" \
  "${SCRIPT_DIR}/deploy.sh"

  wait_for_healthcheck
  log "VM publish complete"
  log "Application is healthy at ${HEALTHCHECK_URL}"
}

main "$@"
