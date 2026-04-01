#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="${REPO_URL:-https://github.com/ITadvocate/image-tool.git}"
APP_GIT_REF="${APP_GIT_REF:-develop}"
APP_NAME="${APP_NAME:-image-tool}"
K8S_NAMESPACE="${K8S_NAMESPACE:-image-tool}"
K8S_SERVICE_TYPE="${K8S_SERVICE_TYPE:-LoadBalancer}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io/itadvocate}"
IMAGE_NAME="${IMAGE_NAME:-image-tool}"
IMAGE_TAG="${IMAGE_TAG:-develop}"
IMAGE_REF="${IMAGE_REF:-${IMAGE_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}}"
PUBLISH_SOURCE_IMAGE="${PUBLISH_SOURCE_IMAGE:-0}"
GHCR_USERNAME="${GHCR_USERNAME:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
K8S_REPLICAS="${K8S_REPLICAS:-2}"
K8S_PERSISTENCE="${K8S_PERSISTENCE:-1}"
UPLOADS_STORAGE_SIZE="${UPLOADS_STORAGE_SIZE:-5Gi}"
PROCESSED_STORAGE_SIZE="${PROCESSED_STORAGE_SIZE:-10Gi}"
STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME:-}"
INGRESS_HOST="${INGRESS_HOST:-}"
REQUIRED_FILES=("docker-compose.yml" "package.json" "server.js" "Dockerfile" ".env.example")

log() {
  printf '[publish-k8s] %s\n' "$1"
}

fail() {
  printf '[publish-k8s] ERROR: %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_linux() {
  [[ "$(uname -s)" == "Linux" ]] || fail "This script targets Linux Kubernetes operator hosts."
}

init_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=""
    return
  fi

  command_exists sudo || fail "sudo is required for dependency installation."
  SUDO="sudo"
}

run_root() {
  if [[ -n "${SUDO}" ]]; then
    sudo "$@"
  else
    "$@"
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
      run_root apt-get update -y
      run_root apt-get install -y ca-certificates curl git gnupg rsync
      ;;
    dnf)
      run_root dnf install -y ca-certificates curl git gnupg2 rsync
      ;;
    yum)
      run_root yum install -y ca-certificates curl git gnupg2 rsync
      ;;
  esac
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

ensure_env_file() {
  if [[ ! -f "${SCRIPT_DIR}/.env" && -f "${SCRIPT_DIR}/.env.example" ]]; then
    cp "${SCRIPT_DIR}/.env.example" "${SCRIPT_DIR}/.env"
    log "Created .env from .env.example"
  fi
}

kubectl_ready() {
  command_exists kubectl && kubectl cluster-info >/dev/null 2>&1
}

install_kubectl() {
  local arch version

  command_exists kubectl && return

  arch="$(uname -m)"
  case "${arch}" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "Unsupported CPU architecture for kubectl install: ${arch}" ;;
  esac

  version="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
  log "Installing kubectl ${version}"
  curl -fsSL -o /tmp/kubectl "https://dl.k8s.io/release/${version}/bin/linux/${arch}/kubectl"
  run_root install -m 0755 /tmp/kubectl /usr/local/bin/kubectl
  rm -f /tmp/kubectl
}

docker_ready() {
  command_exists docker && docker info >/dev/null 2>&1
}

install_docker() {
  local manager arch os_id codename repo_url
  manager="$(pkg_manager)"

  docker_ready && return

  log "Installing Docker because PUBLISH_SOURCE_IMAGE=1"
  case "${manager}" in
    apt)
      arch="$(dpkg --print-architecture)"
      os_id="$(. /etc/os-release && echo "${ID}")"
      codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
      [[ -n "${codename}" ]] || fail "Unable to detect Linux codename for Docker repo setup."

      run_root install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/${os_id}/gpg" | run_root gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      run_root chmod a+r /etc/apt/keyrings/docker.gpg
      repo_url="deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${os_id} ${codename} stable"
      printf '%s\n' "${repo_url}" | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null
      run_root apt-get update -y
      run_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    dnf)
      run_root dnf -y install dnf-plugins-core
      run_root dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      run_root dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    yum)
      run_root yum install -y yum-utils
      run_root yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      run_root yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
  esac

  run_root systemctl enable --now docker
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

publish_image() {
  [[ "${PUBLISH_SOURCE_IMAGE}" == "1" ]] || return

  [[ -n "${GHCR_USERNAME}" ]] || fail "Set GHCR_USERNAME when PUBLISH_SOURCE_IMAGE=1."
  [[ -n "${GHCR_TOKEN}" ]] || fail "Set GHCR_TOKEN when PUBLISH_SOURCE_IMAGE=1."

  install_docker
  wait_for_docker

  log "Logging in to GHCR"
  printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin

  log "Building ${IMAGE_REF}"
  docker build -t "${IMAGE_REF}" "${SCRIPT_DIR}"

  log "Pushing ${IMAGE_REF}"
  docker push "${IMAGE_REF}"
}

storage_class_block() {
  if [[ -n "${STORAGE_CLASS_NAME}" ]]; then
    printf '  storageClassName: %s\n' "${STORAGE_CLASS_NAME}"
  fi
}

create_namespace() {
  kubectl get namespace "${K8S_NAMESPACE}" >/dev/null 2>&1 || kubectl create namespace "${K8S_NAMESPACE}"
}

apply_env_configmap() {
  kubectl -n "${K8S_NAMESPACE}" create configmap "${APP_NAME}-env" \
    --from-env-file="${SCRIPT_DIR}/.env" \
    --dry-run=client -o yaml | kubectl apply -f -
}

apply_persistent_volumes() {
  [[ "${K8S_PERSISTENCE}" == "1" ]] || return

  cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${APP_NAME}-uploads
  namespace: ${K8S_NAMESPACE}
spec:
  accessModes:
    - ReadWriteOnce
$(storage_class_block)
  resources:
    requests:
      storage: ${UPLOADS_STORAGE_SIZE}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${APP_NAME}-processed
  namespace: ${K8S_NAMESPACE}
spec:
  accessModes:
    - ReadWriteOnce
$(storage_class_block)
  resources:
    requests:
      storage: ${PROCESSED_STORAGE_SIZE}
EOF
}

volume_mounts_block() {
  cat <<EOF
          volumeMounts:
            - name: uploads
              mountPath: /app/uploads
            - name: processed
              mountPath: /app/processed
EOF
}

volumes_block() {
  if [[ "${K8S_PERSISTENCE}" == "1" ]]; then
    cat <<EOF
      volumes:
        - name: uploads
          persistentVolumeClaim:
            claimName: ${APP_NAME}-uploads
        - name: processed
          persistentVolumeClaim:
            claimName: ${APP_NAME}-processed
EOF
    return
  fi

  cat <<EOF
      volumes:
        - name: uploads
          emptyDir: {}
        - name: processed
          emptyDir: {}
EOF
}

apply_workload() {
  cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP_NAME}
  namespace: ${K8S_NAMESPACE}
spec:
  replicas: ${K8S_REPLICAS}
  selector:
    matchLabels:
      app: ${APP_NAME}
  template:
    metadata:
      labels:
        app: ${APP_NAME}
    spec:
      containers:
        - name: ${APP_NAME}
          image: ${IMAGE_REF}
          imagePullPolicy: Always
          ports:
            - containerPort: ${CONTAINER_PORT}
              name: http
          envFrom:
            - configMapRef:
                name: ${APP_NAME}-env
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
          readinessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 20
            periodSeconds: 20
$(volume_mounts_block)
$(volumes_block)
---
apiVersion: v1
kind: Service
metadata:
  name: ${APP_NAME}
  namespace: ${K8S_NAMESPACE}
spec:
  type: ${K8S_SERVICE_TYPE}
  selector:
    app: ${APP_NAME}
  ports:
    - name: http
      port: 80
      targetPort: ${CONTAINER_PORT}
EOF
}

apply_ingress() {
  [[ -n "${INGRESS_HOST}" ]] || return

  cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${APP_NAME}
  namespace: ${K8S_NAMESPACE}
spec:
  rules:
    - host: ${INGRESS_HOST}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${APP_NAME}
                port:
                  number: 80
EOF
}

wait_for_rollout() {
  kubectl -n "${K8S_NAMESPACE}" rollout status deployment/"${APP_NAME}" --timeout=300s
}

print_summary() {
  log "Kubernetes publish complete"
  kubectl -n "${K8S_NAMESPACE}" get deployment,pods,svc,ingress
}

main() {
  require_linux
  init_sudo
  ensure_base_packages
  ensure_source_tree
  ensure_env_file
  install_kubectl
  kubectl_ready || fail "kubectl cannot reach a Kubernetes cluster. Check your kubeconfig and context."
  publish_image
  create_namespace
  apply_env_configmap
  apply_persistent_volumes
  apply_workload
  apply_ingress
  wait_for_rollout
  print_summary
}

main "$@"
