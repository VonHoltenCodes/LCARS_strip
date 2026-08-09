#!/usr/bin/env bash
# LCARS_strip kiosk launcher — SB2 GeeekPi 6.9" (1424x280) on HDMI-2.
# Waits for X and the panel, arranges outputs, pins touch to the strip,
# then runs chromium fullscreen on the GeeekPi. Managed by the user
# service lcars-kiosk.service (Restart=always).
export DISPLAY=:0 XAUTHORITY="$HOME/.Xauthority"

# wait for the X server (autologin brings it up at boot)
for _ in $(seq 1 60); do [ -S /tmp/.X11-unix/X0 ] && break; sleep 2; done
# wait for the panel backend
for _ in $(seq 1 60); do curl -sf -o /dev/null http://localhost:8898/ && break; sleep 2; done

# layout: GeeekPi native mode, to the right of the DP-3 utility monitor
xrandr --output HDMI-2 --mode 1424x280 --pos 1280x0 2>/dev/null || true
# touchscreen maps to the strip only (not the whole virtual screen)
xinput list | grep -i touchscreen | grep -o 'id=[0-9]*' | cut -d= -f2 | \
  while read -r id; do xinput map-to-output "$id" HDMI-2 2>/dev/null || true; done

exec /snap/bin/chromium --kiosk --noerrdialogs --disable-session-crashed-bubble \
  --disable-infobars --check-for-update-interval=31536000 \
  --window-position=1280,0 --window-size=1424,280 http://localhost:8898/
