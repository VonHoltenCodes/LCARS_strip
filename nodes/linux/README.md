# Linux node setup

One command — Netdata's official kickstart:

```bash
wget -O /tmp/netdata-kickstart.sh https://get.netdata.cloud/kickstart.sh
sh /tmp/netdata-kickstart.sh --stable-channel --disable-telemetry
```

That's it. Netdata listens on **:19999** and LCARS_strip polls it directly —
no streaming, no parent, no cloud account.

## Firewall (recommended)

Allow 19999 from the panel host only (replace `PANEL_IP`):

```bash
# ufw (Ubuntu/Pop!_OS/Debian)
sudo ufw allow from PANEL_IP to any port 19999 proto tcp

# firewalld (Fedora)
sudo firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=PANEL_IP port port=19999 protocol=tcp accept'
sudo firewall-cmd --reload
```

## NVIDIA GPU (optional)

If the node has an NVIDIA card and `nvidia-smi` works, Netdata picks it up
automatically (`nvidia_smi` collector). Set `"gpu": true` on the node in the
panel config and the GPU dial + temperature appear in its drill-down.

## Verify from the panel host

```bash
curl -s http://NODE_IP:19999/api/v1/info | head -c 300
```

Any JSON back = ready. Add the node via ⚙ NODES → SCAN.
