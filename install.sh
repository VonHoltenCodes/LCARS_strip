#!/usr/bin/env bash
# LCARS_strip installer — panel host (Linux).
# Installs to /opt/lcars-strip, config to /etc/lcars-strip/fleet.json,
# runs as the systemd service `lcars-strip` on port 8899.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root:  sudo ./install.sh"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "▸ installing files to /opt/lcars-strip"
mkdir -p /opt/lcars-strip
cp -r "$SRC/server.py" "$SRC/index.html" "$SRC/js" "$SRC/css" "$SRC/assets" \
      /opt/lcars-strip/ 2>/dev/null || true

echo "▸ config"
mkdir -p /etc/lcars-strip
if [ ! -f /etc/lcars-strip/fleet.json ]; then
  cp "$SRC/fleet.json.example" /etc/lcars-strip/fleet.json
  echo "  created /etc/lcars-strip/fleet.json (EDIT THIS — put your node IPs in)"
else
  echo "  keeping existing /etc/lcars-strip/fleet.json"
fi

# net-snmp CLI tools — only needed for xp-snmp nodes; install if a pkg mgr is known
if ! command -v snmpwalk >/dev/null; then
  echo "▸ snmpwalk not found (needed only for Windows-XP/SNMP nodes)"
  if command -v apt-get >/dev/null; then apt-get install -y snmp >/dev/null && echo "  installed net-snmp (apt)";
  elif command -v dnf >/dev/null; then dnf install -y net-snmp-utils >/dev/null && echo "  installed net-snmp (dnf)";
  elif command -v pacman >/dev/null; then pacman -S --noconfirm net-snmp >/dev/null && echo "  installed net-snmp (pacman)";
  else echo "  ⚠ install net-snmp manually if you want XP nodes"; fi
fi

echo "▸ systemd service"
cp "$SRC/systemd/lcars-strip.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lcars-strip.service

sleep 1
if systemctl is-active --quiet lcars-strip; then
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo ""
  echo "✔ LCARS_strip is running:  http://${ip:-localhost}:8899/"
  echo "  · add nodes with the ⚙ NODES button, or edit /etc/lcars-strip/fleet.json"
  echo "  · each monitored node needs an agent — see nodes/README.md"
else
  echo "✕ service failed to start — check:  journalctl -u lcars-strip -n 30"
  exit 1
fi
