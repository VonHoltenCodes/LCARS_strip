# Windows XP / retro node setup (SNMP)

Yes — your Windows XP battlestation can sit on the panel next to the modern
rigs. XP ships with an SNMP agent; LCARS_strip polls it directly (Host
Resources MIB: CPU load, RAM, disk) plus ping latency. No software to install
beyond what's on your XP media.

## 1. Install the SNMP service — the i386 gotcha

SNMP is a Windows *component*, not installed by default:

**Control Panel → Add or Remove Programs → Add/Remove Windows Components →
Management and Monitoring Tools → ☑ Simple Network Management Protocol**

Here's the part that stops most people: the installer asks for the **XP
`i386` source files** (it needs `snmp.ex_`, `snmpapi.dl_`, and friends).

- **Have your XP CD?** Point the installer at the CD's `i386` folder. Done.
- **Installed from an image / no CD?** Mount your XP ISO (any modern OS
  mounts ISOs; on XP itself use a tool like WinCDEmu, or extract the ISO with
  7-Zip on another machine and copy the `i386` folder over the network or on
  a USB stick). Point the installer at that `i386` folder.
- **No media at all?** We've archived exactly the component set this guide
  needs (the SNMP files pulled from XP SP3 `i386`, plus the expanded MIBs):
  **<https://archive.org/details/windows-xp-sp3-snmp-files>**
  Download it, point the component installer at the folder, and continue.
  You need a matching service pack — this set is **SP3**.

> We don't bundle the `i386` files in this repo — they're Microsoft's
> binaries, not ours to redistribute under GPLv3. The archive.org item above
> is hosted by the Internet Archive as software preservation for keeping
> vintage hardware operational; sets like it have been available there for
> years. Fair warning: if Microsoft ever objects, it could be taken down —
> in that case, fall back to the your-own-media steps above, which always
> work.

## 2. Configure the SNMP service

`services.msc` → **SNMP Service** → Properties:

- **Security tab**
  - *Accepted community names* → **Add** → Community: e.g. `public`
    (or your own name — set the same in the panel's node config), Rights:
    **READ ONLY** is all the panel needs.
  - Select **"Accept SNMP packets from these hosts"** → Add the **panel
    host's IP**. Don't leave it open to any host.
- **Agent tab** (optional) — contact/location strings, shown by scanners.
- **Traps tab** — not used by LCARS_strip (we poll; we don't listen for
  traps). Configure only if something else consumes them.

Restart the SNMP Service after changes. If XP's firewall is on, it opens
UDP 161 automatically with the service; verify under Firewall → Exceptions.

## 3. Verify from the panel host

```bash
snmpwalk -v2c -c public XP_IP 1.3.6.1.2.1.25.3.3.1.2   # CPU load per core
```

Numbers back = ready. Add it on the panel: **⚙ NODES → IP → SCAN** — it
detects as `xp-snmp` and gets the retro CRT treatment automatically.

Works the same for anything speaking SNMP with Host Resources — Windows
2000/2003, NT, even some NAS boxes and printers (your mileage on those).
