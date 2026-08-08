# LCARS_strip

**A retro fleet monitor for your home lab — needle gauges, LED bars, CRT
scanlines — that watches everything from your newest GPU rig down to a
Windows XP box.**

![LCARS_strip main panel](docs/img/main_panel.png)

Designed for the **GeeekPi 6.9″ ultrawide LCD touchscreen (1424×280)** in a
1U slot of a 10″ mini rack — but it runs in any browser and scales itself to
any screen. One small Python server, no dependencies, no cloud, no accounts,
no subscriptions. GPLv3.

## What it monitors

| Node type | How | What you get |
|---|---|---|
| **Linux** | polls the node's own [Netdata](https://www.netdata.cloud/) agent (`:19999`) | CPU · NET · RAM · DISK · uptime · NVIDIA GPU util/temp |
| **Windows 10/11** | polls [windows_exporter](https://github.com/prometheus-community/windows_exporter) (`:9182`) + optional [nvidia_gpu_exporter](https://github.com/utkuozdemir/nvidia_gpu_exporter) (`:9835`) | CPU · NET · RAM · DISK · uptime · GPU util/temp |
| **Windows XP / retro** | SNMP (Host Resources MIB) + ping | CPU · RAM · DISK · uptime · latency, in full CRT-green |

Every node is polled **directly** by the panel — there is no aggregation
server, no streaming parent, no message bus. If the panel host can reach the
node's agent port, it's on the strip.

![Drill-down on a Windows XP node](docs/img/drill_down_retrobeast.png)

## Features

- **Speedometer needles** for CPU/NET, **LED bar meters** for RAM/DISK, a
  GPU/NET reservoir tank, zone-colored health LEDs (green/amber/red)
- **Touch-first**: tap a card for a full drill-down (hardware specs, GPU °C,
  uptime, latency) · drag to pan · **long-press + drag to reorder** cards
  (order persists)
- **⚙ NODES console** — add a machine by typing its IP and hitting **SCAN**:
  the panel auto-detects Linux / Windows / SNMP and fills in the rest.
  Or hand-edit `/etc/lcars-strip/fleet.json` — same thing.
- **Retro nodes get the retro treatment** — phosphor-green CRT faces for the
  XP-era hardware
- Offline nodes dim out and flag the ticker; the panel self-recovers when
  they return

## Install (panel host — Linux)

**Debian/Ubuntu/Pop!_OS — grab the `.deb` from
[Releases](https://github.com/VonHoltenCodes/LCARS_strip/releases):**

```bash
sudo apt install ./lcars-strip_*_all.deb
```

**Any distro — from source:**

```bash
git clone https://github.com/VonHoltenCodes/LCARS_strip.git
cd LCARS_strip
sudo ./install.sh
```

(Building the `.deb` yourself: `./packaging/build-deb.sh` → `dist/`.)

Open `http://<panel-host>:8899/`, hit **⚙ NODES**, and start adding IPs.

Each monitored machine needs its one agent — per-OS guides and scripts are in
[`nodes/`](nodes/README.md):

- **Linux**: one Netdata kickstart command
- **Windows 10/11**: one PowerShell script (`nodes/windows/`)
- **Windows XP**: enable the built-in SNMP service (`nodes/xp/README.md` —
  including the `i386` files gotcha)

## Kiosk mode (the 1U touchscreen)

```bash
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble http://localhost:8899/
```

A ready-made systemd user service for boot-to-panel is in `kiosk/` (optional).

## Config

`/etc/lcars-strip/fleet.json` — see [`fleet.json.example`](fleet.json.example).
Per node: `name`, `host`, `type` (`linux` | `windows` | `xp-snmp`), optional
`use` (role caption), `gpu`, `retro` (CRT styling), `hero` (accent card),
`community` (SNMP), `hw` (spec table shown in the drill-down).

The config API is unauthenticated by design — run this on a LAN you trust,
and don't port-forward the panel to the internet.

## Provenance

Designed and built in the NEONpulse Tech Shop lab: the visual language is
borrowed from our own gear — EasyAmp's brushed chrome and DSEG gauges,
NeonPulse's CRT scanline overlays, and an LCARS frame to hold it together.
First deployment watches nine machines spanning 2003–2025.

## License

GPLv3 — see [LICENSE](LICENSE).
