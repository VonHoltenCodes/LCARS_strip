#!/usr/bin/env python3
"""LCARS_strip backend: serves the panel + /api/fleet (live Netdata, normalized)."""
import json, os, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ND   = "http://127.0.0.1:19999"
ROOT = os.environ.get("LCARS_ROOT", "/home/traxx/LCARS_strip")

# Fleet: nd = Netdata node name; type = linux|windows|snmp
NODES = [
  {"id":"starbase1","name":"STARBASE1","nd":"starbase1","type":"linux","role":"child","use":"MEDIA · PLEX · DNS"},
  {"id":"starbase2","name":"STARBASE2","nd":"starbase2","type":"linux","role":"PARENT","use":"WEB · DB · MONITOR","hero":True},
  {"id":"cybertower","name":"CYBERTOWER","nd":"pop-os","type":"linux","role":"child","use":"DEV WORKSTATION","gpu":True,"retro":True},
  {"id":"skytech","name":"SKYTECH","nd":"SKYTECH","type":"windows","role":"child","use":"RACING SIM","gpu":True},
  {"id":"vonholten308","name":"VONHOLTEN308","nd":"VONHOLTEN308","type":"windows","role":"child","use":"STARSHIP · MOBILE","gpu":True},
  {"id":"kidsdesk","name":"KIDS DESK","nd":"kidsdesk","type":"linux","role":"child","use":"FAMILY PC"},
  {"id":"gigalab","name":"GIGALAB","nd":"gigalab","type":"linux","role":"child","use":"LAB BENCH"},
  {"id":"labstudio","name":"LAB STUDIO","nd":"lab-studio","type":"linux","role":"child","use":"PLEX RECEIVER","gpu":True},
  {"id":"retrobeast","name":"RETROBEAST-V2","nd":"RETROBEAST-V2","type":"snmp","role":"lite","use":"WINDOWS XP","retro":True},
]

_charts = {}   # host -> [chart ids]  (cached; ids are stable)

def nd_get(path):
    try:
        with urllib.request.urlopen(ND + path, timeout=3) as r:
            return json.load(r)
    except Exception:
        return None

def charts(host):
    if host not in _charts:
        d = nd_get("/host/%s/api/v1/charts" % urllib.parse.quote(host))
        _charts[host] = list(d["charts"].keys()) if d and d.get("charts") else []
    return _charts[host]

def cid(host, *subs):
    for c in charts(host):
        if all(s in c for s in subs):
            return c
    return None

def dims(host, chart):
    if not chart: return None
    d = nd_get("/host/%s/api/v1/data?chart=%s&after=-1&points=1&format=json"
               % (urllib.parse.quote(host), urllib.parse.quote(chart)))
    if not d or not d.get("data"): return None
    return {k: (v if isinstance(v,(int,float)) else 0) for k, v in zip(d["labels"][1:], d["data"][0][1:])}

def clamp(v):
    try: return round(max(0.0, min(100.0, float(v))), 1)
    except: return None

def linux_metrics(h):
    o = {}
    c = dims(h, cid(h, "system.cpu"))
    if c: o["cpu"] = clamp(sum(c.values()))
    r = dims(h, cid(h, "system.ram"))
    if r:
        tot = sum(r.values())
        o["ram"] = clamp(r.get("used", 0)/tot*100) if tot else None
    n = dims(h, cid(h, "system.net"))
    if n: o["net"] = clamp(sum(abs(v) for v in n.values())/1000.0)  # kbps -> % of ~100Mbps
    d = dims(h, cid(h, "disk_space./"))
    if d:
        tot = sum(d.values())
        o["disk"] = clamp(d.get("used", 0)/tot*100) if tot else None
    u = dims(h, cid(h, "system.uptime"))
    if u: o["uptime"] = int(list(u.values())[0])
    g = dims(h, cid(h, "nvidia_smi", "gpu_utilization")) or dims(h, cid(h, "nvidia", "utilization"))
    if g: o["gpuutil"] = clamp(list(g.values())[0])
    gt = dims(h, cid(h, "nvidia_smi", "temperature")) or dims(h, cid(h, "nvidia", "temperature"))
    if gt: o["gputemp"] = round(list(gt.values())[0])
    o["online"] = "cpu" in o
    return o

def win_metrics(h):
    o = {}
    idle = dims(h, cid(h, "windows_cpu_time_total", "mode=idle"))
    if idle: o["cpu"] = clamp(100*(1 - sum(idle.values())/len(idle)))
    avail = dims(h, cid(h, "windows_memory_available_bytes"))
    total = dims(h, cid(h, "windows_memory_physical_total_bytes"))
    if avail and total:
        a = list(avail.values())[0]; t = list(total.values())[0]
        o["ram"] = clamp((1 - a/t)*100) if t else None
    net = dims(h, cid(h, "windows_net_bytes_total")) or dims(h, cid(h, "windows_net_bytes_received_total"))
    if net: o["net"] = clamp(sum(abs(v) for v in net.values())*8/1e6/1000.0*100)
    ld = dims(h, cid(h, "windows_logical_disk_free_bytes", "volume=C:"))
    lt = dims(h, cid(h, "windows_logical_disk_size_bytes", "volume=C:"))
    if ld and lt:
        f = list(ld.values())[0]; t = list(lt.values())[0]
        o["disk"] = clamp((1 - f/t)*100) if t else None
    g = dims(h, cid(h, "nvidia_smi_utilization_gpu_ratio"))
    if g: o["gpuutil"] = clamp(list(g.values())[0]*100)
    gt = dims(h, cid(h, "nvidia_smi_temperature_gpu\""))  # exact metric, not _tlimit
    if not gt: gt = dims(h, cid(h, "nvidia_smi_temperature_gpu-"))
    if gt: o["gputemp"] = round(list(gt.values())[0])
    up = dims(h, cid(h, "windows_system_system_up_time"))
    o["online"] = "cpu" in o or "ram" in o
    return o

def snmp_metrics(h):
    o = {}
    c = dims(h, cid(h, "retrobeast_cpu_percent"))
    if c: o["cpu"] = clamp(list(c.values())[0])
    ram = dims(h, cid(h, "retrobeast_storage_used_percent", "physical_memory"))
    if ram: o["ram"] = clamp(list(ram.values())[0])
    dk = dims(h, cid(h, "retrobeast_storage_used_percent", "disk_c"))
    if dk: o["disk"] = clamp(list(dk.values())[0])
    lat = dims(h, cid(h, "retrobeast_latency_ms"))
    if lat: o["latency"] = round(list(lat.values())[0], 2)
    rc = dims(h, cid(h, "retrobeast_reachable"))
    o["online"] = bool(rc and list(rc.values())[0] >= 1)
    return o

def fleet():
    out = []
    for n in NODES:
        try:
            m = {"linux":linux_metrics,"windows":win_metrics,"snmp":snmp_metrics}[n["type"]](n["nd"])
        except Exception as e:
            m = {"online": False, "err": str(e)}
        out.append({**{k:n[k] for k in ("id","name","type","role","use") if k in n},
                    "hero": n.get("hero", False), "gpu": n.get("gpu", False), "retro": n.get("retro", False),
                    **m})
    return {"nodes": out}

class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b))); self.send_header("Cache-Control","no-store")
        self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path
        if p == "/api/fleet":
            self._send(200, json.dumps(fleet()), "application/json"); return
        rel = "index.html" if p in ("/", "") else p.lstrip("/")
        fp = os.path.normpath(os.path.join(ROOT, rel))
        if not fp.startswith(ROOT) or not os.path.isfile(fp):
            self._send(404, "not found", "text/plain"); return
        ext = os.path.splitext(fp)[1]
        ct = {".html":"text/html",".css":"text/css",".js":"application/javascript",
              ".ttf":"font/ttf",".png":"image/png",".json":"application/json"}.get(ext,"application/octet-stream")
        with open(fp, "rb") as f:
            self._send(200, f.read(), ct)
    def log_message(self, *a): pass

if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8899), H).serve_forever()
