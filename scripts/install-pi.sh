#!/usr/bin/env bash
# Install or update Family Skylight as a system service on a Raspberry Pi.
# Run this script on the Pi as jhart (it will request sudo when needed).

set -euo pipefail

APP_USER="jhart"
APP_DIR="/Github/family-skylight"
SERVICE_NAME="family-skylight.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"

if ! id "${APP_USER}" >/dev/null 2>&1; then
  echo "The ${APP_USER} user does not exist. Create it before installing." >&2
  exit 1
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "Expected a Git checkout at ${APP_DIR}." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "This installer requires systemd." >&2
  exit 1
fi

# Stop both the managed service and a prior manually launched server.
sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
sudo pkill -TERM -u "${APP_USER}" -f "tsx.*src/server\\.ts" 2>/dev/null || true

# Keep the checkout and runtime data writable by the account that runs the app.
APP_GROUP="$(id -gn "${APP_USER}")"
sudo chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"

run_as_app_user() {
  sudo -u "${APP_USER}" -H "$@"
}

run_as_app_user git -C "${APP_DIR}" pull --ff-only
run_as_app_user npm --prefix "${APP_DIR}" ci
run_as_app_user npm --prefix "${APP_DIR}" run build

# Resolve the actual Node/npm installation used by jhart. This also supports a
# non-default Node install as long as it is available to jhart when installing.
NPM_BIN="$(sudo -u "${APP_USER}" -H sh -lc 'command -v npm')"
NODE_BIN="$(sudo -u "${APP_USER}" -H sh -lc 'command -v node')"
if [[ -z "${NPM_BIN}" || -z "${NODE_BIN}" ]]; then
  echo "Node.js and npm must be installed and available to ${APP_USER}." >&2
  exit 1
fi
NODE_DIR="$(dirname "${NODE_BIN}")"

sudo tee "${SERVICE_PATH}" >/dev/null <<UNIT
[Unit]
Description=Family Skylight
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PATH=${NODE_DIR}:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=-${APP_DIR}/.env
ExecStart=${NPM_BIN} start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}"

echo "Family Skylight is running as ${APP_USER}."
echo "Check its status with: sudo systemctl status ${SERVICE_NAME}"
echo "Follow logs with: sudo journalctl -u ${SERVICE_NAME} -f"
