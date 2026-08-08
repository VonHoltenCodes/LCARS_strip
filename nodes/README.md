# Making your machines visible to LCARS_strip

Two roles, one rule:

- **Panel host** — the Linux box running LCARS_strip (`install.sh` handled it).
- **Every monitored node** — needs exactly **one agent + one open port**,
  reachable from the panel host. That's the whole job of this folder.

| Node OS | Agent | Port | Setup |
|---|---|---|---|
| Linux | Netdata | 19999 | [`linux/`](linux/README.md) — one command |
| Windows 10/11 | windows_exporter (+ optional NVIDIA GPU exporter) | 9182 (+9835) | [`windows/`](windows/) — one PowerShell script |
| Windows XP / retro | SNMP service (built into XP) | 161/udp | [`xp/`](xp/README.md) — Control Panel + your XP media |

After the agent is up, add the node on the panel with the **⚙ NODES** button —
enter its IP, hit **SCAN**, and the type is auto-detected.

**Firewall tip:** scope the agent port to the panel host's IP only (each guide
shows how). A monitoring agent is not something the whole LAN needs to reach.
