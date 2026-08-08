#!/usr/bin/env bash
# Build the lcars-strip .deb (arch: all, pure python3-stdlib).
#   ./packaging/build-deb.sh [version]     -> dist/lcars-strip_<version>_all.deb
set -euo pipefail
VERSION="${1:-1.0.0}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

# ---- payload -----------------------------------------------------------
APP="$BUILD/opt/lcars-strip"
mkdir -p "$APP" "$BUILD/lib/systemd/system" "$BUILD/DEBIAN" \
         "$BUILD/usr/share/doc/lcars-strip"
cp -r "$SRC/server.py" "$SRC/index.html" "$SRC/js" "$SRC/css" \
      "$SRC/fleet.json.example" "$APP/"
[ -d "$SRC/assets" ] && cp -r "$SRC/assets" "$APP/"
cp -r "$SRC/nodes" "$APP/nodes"                 # per-OS node setup guides/scripts
[ -d "$SRC/kiosk" ] && cp -r "$SRC/kiosk" "$APP/kiosk"
cp "$SRC/systemd/lcars-strip.service" "$BUILD/lib/systemd/system/"
cp "$SRC/README.md" "$BUILD/usr/share/doc/lcars-strip/"
cp "$SRC/LICENSE"   "$BUILD/usr/share/doc/lcars-strip/copyright"

# ---- control files -----------------------------------------------------
SIZE=$(du -sk "$BUILD" --exclude=DEBIAN | cut -f1)
cat > "$BUILD/DEBIAN/control" <<EOF
Package: lcars-strip
Version: $VERSION
Architecture: all
Section: net
Priority: optional
Installed-Size: $SIZE
Depends: python3 (>= 3.7)
Recommends: snmp
Suggests: chromium | chromium-browser
Maintainer: VonHoltenCodes <vonholtencodes@gmail.com>
Homepage: https://github.com/VonHoltenCodes/LCARS_strip
Description: Retro LCARS fleet monitor for home labs (1U touchscreen panel)
 Needle gauges, LED bar meters and CRT scanlines on a 1424x280 ultrawide
 touchscreen (GeeekPi 6.9" / 10" mini rack), or any browser. Directly polls
 each node: Linux (Netdata :19999), Windows 10/11 (windows_exporter :9182,
 nvidia_gpu_exporter :9835) and Windows XP / retro boxes (SNMP + ping).
 Pure Python stdlib server, no cloud, no accounts. The snmp package is only
 needed for XP/SNMP nodes; chromium only for kiosk mode.
EOF

cat > "$BUILD/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
mkdir -p /etc/lcars-strip
[ -f /etc/lcars-strip/fleet.json ] || {
  cp /opt/lcars-strip/fleet.json.example /etc/lcars-strip/fleet.json
  echo "lcars-strip: created /etc/lcars-strip/fleet.json — put your node IPs in it"
  echo "             (or use the gear button on http://localhost:8899/)"
}
if [ "$1" = "configure" ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable --now lcars-strip.service >/dev/null 2>&1 || true
fi
exit 0
EOF

cat > "$BUILD/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
[ "$1" = "remove" ] && { systemctl stop lcars-strip.service >/dev/null 2>&1 || true
                         systemctl disable lcars-strip.service >/dev/null 2>&1 || true; }
exit 0
EOF

cat > "$BUILD/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
[ "$1" = "purge" ] && rm -rf /etc/lcars-strip
systemctl daemon-reload >/dev/null 2>&1 || true
exit 0
EOF

chmod 755 "$BUILD/DEBIAN/postinst" "$BUILD/DEBIAN/prerm" "$BUILD/DEBIAN/postrm"

# ---- build -------------------------------------------------------------
mkdir -p "$SRC/dist"
OUT="$SRC/dist/lcars-strip_${VERSION}_all.deb"
dpkg-deb --build --root-owner-group "$BUILD" "$OUT" >/dev/null
echo "built: $OUT"
dpkg-deb --info "$OUT" | sed -n '1,14p'
