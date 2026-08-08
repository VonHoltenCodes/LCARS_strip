#!/usr/bin/env python3
"""LCARS_strip — self-contained fleet-monitor backend (direct-poll).

Polls every node DIRECTLY — no Netdata parent, no vnodes, no shim layer:
  linux    -> the node's own Netdata agent      http://<host>:19999
  windows  -> windows_exporter                  http://<host>:9182/metrics
              (+ nvidia_gpu_exporter            http://<host>:9835/metrics)
  xp-snmp  -> SNMP v2c Host Resources MIB (snmpwalk) + ping

Config: $LCARS_CONF > /etc/lcars-strip/fleet.json > ./fleet.json
Pure Python stdlib. xp-snmp nodes need the net-snmp CLI tools (`snmpwalk`).

Endpoints:
  GET  /               the panel (static files)
  GET  /api/fleet      latest snapshot of every node, normalized
  GET  /api/config     current fleet.json
  POST /api/config     replace config (validated, written atomically, hot-reload)
  POST /api/probe      {"host": "..."} -> auto-detect node type + suggested entry
"""
import json, os, re, socket, subprocess, threading, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
CONF_PATHS = [p for p in (os.environ.get("LCARS_CONF"),
                          "/etc/lcars-strip/fleet.json",
                          os.path.join(ROOT, "fleet.json")) if p]
TYPES = ("linux", "windows", "xp-snmp", "weather")

# ---------------------------------------------------------------- config
_cfg_lock = threading.Lock()
_cfg = {"port": 8899, "poll_seconds": 2, "nodes": []}
_cfg_path = None

def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-") or "node"

def norm_node(n):
    """Fill defaults; raise ValueError on junk."""
    if not isinstance(n, dict): raise ValueError("node must be an object")
    t = n.get("type", "linux")
    if t not in TYPES: raise ValueError("type must be one of %s" % (TYPES,))
    host = str(n.get("host", "")).strip()
    if t == "weather":
        host = ""                                    # weather card has no host
    elif not host or re.search(r"[\s/]", host):
        raise ValueError("bad host: %r" % host)
    name = str(n.get("name") or host or "WEATHER").strip()
    out = {"id": n.get("id") or slugify(name), "name": name, "host": host, "type": t,
           "use": str(n.get("use", "")), "hero": bool(n.get("hero")),
           "retro": bool(n.get("retro")), "gpu": bool(n.get("gpu")),
           "hw": n.get("hw") if isinstance(n.get("hw"), dict) else {}}
    if t == "xp-snmp":
        out["community"] = str(n.get("community", "public"))
    return out

def norm_config(c):
    if not isinstance(c, dict): raise ValueError("config must be an object")
    nodes = [norm_node(n) for n in c.get("nodes", [])]
    ids = [n["id"] for n in nodes]
    if len(ids) != len(set(ids)): raise ValueError("duplicate node ids")
    w = c.get("weather")
    weather = ({"lat": float(w["lat"]), "lon": float(w["lon"])}
               if isinstance(w, dict) and "lat" in w and "lon" in w else None)
    a = c.get("alerts") if isinstance(c.get("alerts"), dict) else {}
    alerts = {"cpu": float(a.get("cpu", 88)), "ram": float(a.get("ram", 88)),
              "disk": float(a.get("disk", 96)), "gputemp": float(a.get("gputemp", 85))}
    return {"title": str(c.get("title") or "FLEET MONITOR")[:40],
            "port": int(c.get("port", 8899)),
            "poll_seconds": max(1, int(c.get("poll_seconds", 2))),
            "weather": weather,
            "alerts": alerts,
            "nodes": nodes}

def load_config():
    global _cfg, _cfg_path
    for p in CONF_PATHS:
        if os.path.isfile(p):
            with open(p) as f:
                _cfg = norm_config(json.load(f))
            _cfg_path = p
            return
    _cfg_path = CONF_PATHS[-1]   # nothing found: start empty, save target = last

def save_config(c):
    global _cfg
    c = norm_config(c)
    tmp = _cfg_path + ".tmp"
    os.makedirs(os.path.dirname(_cfg_path) or ".", exist_ok=True)
    with open(tmp, "w") as f:
        json.dump(c, f, indent=2)
        f.write("\n")
    os.replace(tmp, _cfg_path)
    with _cfg_lock:
        _cfg = c
    _wx["station"] = None          # re-resolve if the location changed

# ---------------------------------------------------------------- helpers
def http_get(url, timeout=2.5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")

def http_json(url, timeout=2.5):
    return json.loads(http_get(url, timeout))

def clamp(v):
    try: return round(max(0.0, min(100.0, float(v))), 1)
    except Exception: return None

def ping_ms(host):
    try:
        out = subprocess.check_output(["ping", "-c", "1", "-W", "1", host],
                                      text=True, timeout=4, stderr=subprocess.DEVNULL)
        m = re.search(r"time=([\d.]+)", out)
        return round(float(m.group(1)), 2) if m else None
    except Exception:
        return None

# ---------------------------------------------------------------- linux (Netdata direct)
_charts_cache = {}   # base_url -> [chart ids]

def nd_charts(base):
    if base not in _charts_cache:
        d = http_json(base + "/api/v1/charts")
        _charts_cache[base] = list(d.get("charts", {}).keys())
    return _charts_cache[base]

def nd_cid(base, *subs):
    for c in nd_charts(base):
        if all(s in c for s in subs):
            return c
    return None

def nd_dims(base, chart):
    if not chart: return None
    d = http_json(base + "/api/v1/data?chart=%s&after=-1&points=1&format=json"
                  % urllib.parse.quote(chart))
    if not d.get("data"): return None
    return {k: (v if isinstance(v, (int, float)) else 0)
            for k, v in zip(d["labels"][1:], d["data"][0][1:])}

def linux_metrics(n):
    base = "http://%s:19999" % n["host"]
    o = {}
    c = nd_dims(base, nd_cid(base, "system.cpu"))
    if c: o["cpu"] = clamp(sum(c.values()))
    r = nd_dims(base, nd_cid(base, "system.ram"))
    if r:
        tot = sum(r.values())
        o["ram"] = clamp(r.get("used", 0) / tot * 100) if tot else None
    net = nd_dims(base, nd_cid(base, "system.net"))
    if net: o["net"] = clamp(sum(abs(v) for v in net.values()) / 1000.0)  # kbit/s -> % of 100Mbps
    d = nd_dims(base, nd_cid(base, "disk_space./"))
    if d:
        tot = sum(d.values())
        o["disk"] = clamp(d.get("used", 0) / tot * 100) if tot else None
    u = nd_dims(base, nd_cid(base, "system.uptime"))
    if u: o["uptime"] = int(list(u.values())[0])
    if n.get("gpu"):
        g = nd_dims(base, nd_cid(base, "nvidia_smi", "gpu_utilization")) \
            or nd_dims(base, nd_cid(base, "nvidia", "utilization"))
        if g: o["gpuutil"] = clamp(list(g.values())[0])
        gt = nd_dims(base, nd_cid(base, "nvidia_smi", "temperature")) \
             or nd_dims(base, nd_cid(base, "nvidia", "temperature"))
        if gt: o["gputemp"] = round(list(gt.values())[0])
    o["online"] = "cpu" in o
    return o

# ---------------------------------------------------------------- windows (raw Prometheus)
_prev = {}   # node id -> {"ts":..., "idle":..., "netbytes":...}

def prom_parse(text):
    """-> list of (metric_name, label_string, value)"""
    out = []
    for line in text.splitlines():
        if not line or line[0] == "#": continue
        m = re.match(r"([A-Za-z_:][A-Za-z0-9_:]*)(\{.*\})?\s+([-+0-9.eE]+|NaN)\s*$", line)
        if not m: continue
        try: v = float(m.group(3))
        except ValueError: continue
        if v != v: continue           # NaN
        out.append((m.group(1), m.group(2) or "", v))
    return out

def psum(rows, name, label_sub=None):
    vals = [v for (mn, lb, v) in rows if mn == name and (label_sub is None or label_sub in lb)]
    return sum(vals) if vals else None

def pcount(rows, name, label_sub=None):
    return len([1 for (mn, lb, v) in rows if mn == name and (label_sub is None or label_sub in lb)])

def win_metrics(n):
    o = {}
    now = time.time()
    rows = prom_parse(http_get("http://%s:9182/metrics" % n["host"], timeout=3))
    # CPU%: idle-seconds counter -> rate over the poll interval, divided by core count
    idle = psum(rows, "windows_cpu_time_total", 'mode="idle"')
    ncores = pcount(rows, "windows_cpu_time_total", 'mode="idle"')
    netb = psum(rows, "windows_net_bytes_total")
    p = _prev.get(n["id"])
    if p and idle is not None and now > p["ts"]:
        dt = now - p["ts"]
        if p.get("idle") is not None and ncores:
            rate = (idle - p["idle"]) / dt
            o["cpu"] = clamp(100 * (1 - rate / ncores))
        if p.get("netbytes") is not None and netb is not None:
            mbps = (netb - p["netbytes"]) / dt * 8 / 1e6
            o["net"] = clamp(mbps)            # % of 100Mbps
    _prev[n["id"]] = {"ts": now, "idle": idle, "netbytes": netb}
    avail = psum(rows, "windows_memory_available_bytes")
    total = psum(rows, "windows_memory_physical_total_bytes")
    if avail is not None and total:
        o["ram"] = clamp((1 - avail / total) * 100)
    free = psum(rows, "windows_logical_disk_free_bytes", 'volume="C:"')
    size = psum(rows, "windows_logical_disk_size_bytes", 'volume="C:"')
    if free is not None and size:
        o["disk"] = clamp((1 - free / size) * 100)
    boot = psum(rows, "windows_system_boot_time_timestamp") \
           or psum(rows, "windows_system_system_up_time")      # older exporter name
    if boot: o["uptime"] = max(0, int(now - boot))
    if n.get("gpu"):
        try:
            g = prom_parse(http_get("http://%s:9835/metrics" % n["host"], timeout=3))
            u = psum(g, "nvidia_smi_utilization_gpu_ratio")
            if u is not None: o["gpuutil"] = clamp(u * 100)
            t = psum(g, "nvidia_smi_temperature_gpu")
            if t is not None: o["gputemp"] = round(t)
        except Exception:
            pass                                # GPU exporter down != node down
    o["online"] = "ram" in o or "cpu" in o
    return o

# ---------------------------------------------------------------- xp-snmp (direct walk)
def snmp_walk(host, community, oid):
    try:
        out = subprocess.check_output(
            ["snmpwalk", "-v2c", "-c", community, "-Oqv", "-t", "2", "-r", "1", host, oid],
            text=True, timeout=8, stderr=subprocess.DEVNULL)
        return [l.strip().strip('"') for l in out.splitlines() if l.strip()]
    except Exception:
        return []

def _num(x):
    m = re.match(r"\s*(\d+)", x)          # tolerate "4096 Bytes"
    return int(m.group(1)) if m else None

def snmp_metrics(n):
    host, comm = n["host"], n.get("community", "public")
    o = {}
    loads = [int(x) for x in snmp_walk(host, comm, "1.3.6.1.2.1.25.3.3.1.2") if x.isdigit()]
    if loads: o["cpu"] = clamp(sum(loads) / len(loads))
    descrs = snmp_walk(host, comm, "1.3.6.1.2.1.25.2.3.1.3")
    sizes  = snmp_walk(host, comm, "1.3.6.1.2.1.25.2.3.1.5")
    useds  = snmp_walk(host, comm, "1.3.6.1.2.1.25.2.3.1.6")
    for i in range(min(len(descrs), len(sizes), len(useds))):
        s, us = _num(sizes[i]), _num(useds[i])
        if not s or us is None: continue
        d = descrs[i].lower()
        if d.startswith("physical memory"):
            o["ram"] = clamp(us * 100.0 / s)
        elif re.match(r"c:", d):
            o["disk"] = clamp(us * 100.0 / s)
    up = snmp_walk(host, comm, "1.3.6.1.2.1.25.1.1.0")   # hrSystemUptime
    if up:
        # -Oqv prints timeticks as [d:]h:m:s.cs — or raw ticks on some agents
        m = re.match(r"(?:(\d+):)?(\d+):(\d+):(\d+)(?:\.\d+)?$", up[0])
        if m:
            d, h, mi, s = (int(x or 0) for x in m.groups())
            o["uptime"] = ((d * 24 + h) * 60 + mi) * 60 + s
        elif _num(up[0]) is not None:
            o["uptime"] = _num(up[0]) // 100
    lat = ping_ms(host)
    if lat is not None: o["latency"] = lat
    o["online"] = bool(o.get("cpu") is not None or "ram" in o or lat is not None)
    return o

def weather_metrics(n):
    wx = {k: _wx[k] for k in ("tempF", "cond", "windMph", "windDir", "rh", "place", "station")}
    wx["radar"] = bool(_wx_radar["bytes"])
    return {"online": _wx["tempF"] is not None, "wx": wx}

EXTRACT = {"linux": linux_metrics, "windows": win_metrics, "xp-snmp": snmp_metrics,
           "weather": weather_metrics}

# ---------------------------------------------------------------- poller
_snap_lock = threading.Lock()
_snapshot = {}    # node id -> metrics dict

def poll_node(n):
    try:
        m = EXTRACT[n["type"]](n)
    except Exception as e:
        m = {"online": False, "err": e.__class__.__name__}
    m["at"] = int(time.time())
    return n["id"], m

def poller():
    while True:
        with _cfg_lock:
            nodes = list(_cfg["nodes"]); wait = _cfg["poll_seconds"]
        if nodes:
            with ThreadPoolExecutor(max_workers=min(12, len(nodes))) as ex:
                results = list(ex.map(poll_node, nodes))
            with _snap_lock:
                _snapshot.clear()
                _snapshot.update(dict(results))
        time.sleep(wait)

# ------------------------------------------------- outside temp (api.weather.gov)
_wx = {"tempF": None, "station": None, "cond": None, "windMph": None,
       "windDir": None, "rh": None, "place": None, "radar": None}
_wx_radar = {"bytes": None, "at": 0}          # cached NOAA RIDGE gif

def wx_get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "LCARS_strip (github.com/VonHoltenCodes/LCARS_strip)",
        "Accept": "application/geo+json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.load(r)

def wx_poll():
    while True:
        with _cfg_lock:
            w = _cfg.get("weather") or {}
        lat, lon = w.get("lat"), w.get("lon")
        if lat is None or lon is None:
            _wx["tempF"] = None
            time.sleep(60); continue
        try:
            if not _wx["station"]:
                p = wx_get("https://api.weather.gov/points/%.4f,%.4f" % (float(lat), float(lon)))
                pr0 = p["properties"]
                rl = pr0.get("relativeLocation", {}).get("properties", {})
                if rl.get("city"): _wx["place"] = "%s, %s" % (rl["city"], rl.get("state", ""))
                _wx["radar"] = pr0.get("radarStation")
                st = wx_get(pr0["observationStations"])
                _wx["station"] = st["features"][0]["properties"]["stationIdentifier"]
            o = wx_get("https://api.weather.gov/stations/%s/observations/latest" % _wx["station"])
            pr = o["properties"]
            c = pr["temperature"]["value"]
            _wx["tempF"] = round(c * 9 / 5 + 32) if c is not None else None
            _wx["cond"] = pr.get("textDescription") or None
            ws = pr.get("windSpeed", {}).get("value")
            _wx["windMph"] = round(ws * 0.621371) if ws is not None else None
            wd = pr.get("windDirection", {}).get("value")
            if wd is not None:
                _wx["windDir"] = ["N","NE","E","SE","S","SW","W","NW"][round(wd / 45) % 8]
            rh = pr.get("relativeHumidity", {}).get("value")
            _wx["rh"] = round(rh) if rh is not None else None
        except Exception:
            pass                      # transient — keep the last reading
        try:                          # NOAA RIDGE radar snapshot for the card
            if _wx["radar"]:
                req = urllib.request.Request(
                    "https://radar.weather.gov/ridge/standard/%s_0.gif" % _wx["radar"],
                    headers={"User-Agent": "LCARS_strip (github.com/VonHoltenCodes/LCARS_strip)"})
                with urllib.request.urlopen(req, timeout=10) as r:
                    _wx_radar["bytes"] = r.read()
                    _wx_radar["at"] = int(time.time())
        except Exception:
            pass
        time.sleep(300)               # radar refreshes ~5 min; obs hourly-ish

def fleet():
    with _cfg_lock:
        nodes = list(_cfg["nodes"]); title = _cfg.get("title", "FLEET MONITOR")
        alerts = _cfg.get("alerts") or {}
    with _snap_lock:
        snap = dict(_snapshot)
    out = []
    for n in nodes:
        m = snap.get(n["id"], {"online": False})
        out.append({"id": n["id"], "name": n["name"], "host": n["host"],
                    "type": n["type"], "use": n["use"], "hero": n["hero"],
                    "retro": n["retro"], "gpu": n["gpu"], "hw": n["hw"], **m})
    return {"title": title, "tempF": _wx["tempF"], "alerts": alerts, "nodes": out}

# ---------------------------------------------------------------- probe
def probe(host):
    res = {"host": host, "detected": None, "suggest": None}
    lat = ping_ms(host)
    res["ping_ms"] = lat
    # linux: Netdata agent?
    try:
        info = http_json("http://%s:19999/api/v1/info" % host, timeout=2)
        hw = {}
        if info.get("os_name"): hw["OS"] = "%s %s" % (info["os_name"], info.get("os_version", ""))
        if info.get("cores_total"): hw["CPU"] = "%s cores" % info["cores_total"]
        if info.get("ram_total"): hw["RAM"] = "%.0f GB" % (int(info["ram_total"]) / 2**30)
        res["detected"] = "linux"
        res["suggest"] = {"name": (info.get("mirrored_hosts") or [host])[0].upper(),
                          "host": host, "type": "linux", "hw": hw}
        return res
    except Exception:
        pass
    # windows: windows_exporter?
    try:
        rows = prom_parse(http_get("http://%s:9182/metrics" % host, timeout=2))
        if rows:
            gpu = False
            try:
                gpu = bool(prom_parse(http_get("http://%s:9835/metrics" % host, timeout=2)))
            except Exception:
                pass
            total = psum(rows, "windows_memory_physical_total_bytes")
            hw = {"OS": "Windows", "AGENT": "windows_exporter"}
            if total: hw["RAM"] = "%.0f GB" % (total / 2**30)
            res["detected"] = "windows"
            res["suggest"] = {"name": host, "host": host, "type": "windows", "gpu": gpu, "hw": hw}
            return res
    except Exception:
        pass
    # xp-snmp: anything answering Host Resources?
    for comm in ("public",):
        sysd = snmp_walk(host, comm, "1.3.6.1.2.1.1.1.0")
        if sysd:
            res["detected"] = "xp-snmp"
            res["suggest"] = {"name": host, "host": host, "type": "xp-snmp",
                              "community": comm, "retro": True,
                              "hw": {"OS": sysd[0][:60], "AGENT": "SNMP + ping"}}
            return res
    return res   # nothing detected (ping_ms may still show it's alive)

# ---------------------------------------------------------------- http
MIME = {".html": "text/html", ".css": "text/css", ".js": "application/javascript",
        ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml",
        ".json": "application/json", ".mp4": "video/mp4", ".woff2": "font/woff2"}

class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path
        if p == "/api/fleet":
            return self._send(200, json.dumps(fleet()))
        if p == "/api/config":
            with _cfg_lock:
                return self._send(200, json.dumps(_cfg))
        if p == "/api/radar":
            if _wx_radar["bytes"]:
                return self._send(200, _wx_radar["bytes"], "image/gif")
            return self._send(404, "no radar yet", "text/plain")
        rel = "index.html" if p in ("/", "") else p.lstrip("/")
        fp = os.path.normpath(os.path.join(ROOT, rel))
        if not fp.startswith(ROOT) or not os.path.isfile(fp):
            return self._send(404, "not found", "text/plain")
        with open(fp, "rb") as f:
            self._send(200, f.read(), MIME.get(os.path.splitext(fp)[1], "application/octet-stream"))

    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path
        try:
            if p == "/api/config":
                body = self._json_body()
                save_config(body)
                return self._send(200, json.dumps({"ok": True, "path": _cfg_path}))
            if p == "/api/probe":
                host = str(self._json_body().get("host", "")).strip()
                if not host or re.search(r"[\s/]", host):
                    return self._send(400, json.dumps({"err": "bad host"}))
                return self._send(200, json.dumps(probe(host)))
        except (ValueError, json.JSONDecodeError) as e:
            return self._send(400, json.dumps({"err": str(e)}))
        except OSError as e:
            return self._send(500, json.dumps({"err": "config write failed: %s" % e}))
        self._send(404, json.dumps({"err": "no such endpoint"}))

    def log_message(self, *a): pass

if __name__ == "__main__":
    load_config()
    threading.Thread(target=poller, daemon=True).start()
    threading.Thread(target=wx_poll, daemon=True).start()
    port = int(os.environ.get("LCARS_PORT") or _cfg.get("port", 8899))
    print("lcars-strip: config=%s nodes=%d port=%d" % (_cfg_path, len(_cfg["nodes"]), port), flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
