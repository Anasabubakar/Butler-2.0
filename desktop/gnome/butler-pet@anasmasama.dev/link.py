#!/usr/bin/env python3
"""Butler's file link on the laptop: sends and receives real files, to and from your phone.

The pet starts this and talks to it a line of JSON at a time: commands on stdin, news on
stdout. It runs outside GNOME Shell so big files never slow your screen down.

Two ways to move files, the first one that works:

1. Directly, on the same Wi-Fi or your phone's hotspot, with no internet needed. This
   laptop listens on LINK_PORT over HTTPS with its own certificate. The phone learns that
   certificate's fingerprint from your Butler server (once, while online) and refuses
   anything else, so nobody on the café Wi-Fi can pretend to be your laptop or read the files.
   The phone proves it's yours with your Butler token, which only travels inside that
   encrypted connection. The laptop also calls out "I'm here" on the network every few
   seconds, so the phone finds it when its address changes.
2. Through your Butler server, in pieces, so a dropped connection carries on where it stopped.

Commands (stdin):
  {"cmd": "send", "job": "...", "target": "phone", "paths": ["/home/…/a.jpg", …]}
  {"cmd": "fetch", "job": "...", "from": "android-…", "transfer": {"id", "files", "size"}}
  {"cmd": "cancel", "job": "..."}
News (stdout):
  {"event": "ready", "local": {"port", "fingerprint", "addresses"}}
  {"event": "progress", "job", "direction": "in"|"out", "names", "count", "done", "size", "via", "peer"}
  {"event": "done", "job", "direction", "paths", "folder", "via", "peer"}
  {"event": "failed", "job", "direction", "error"}
"""

import hashlib
import hmac
import http.server
import json
import mimetypes
import os
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid

LINK_PORT = 53320
BEACON_PORT = 53321
PIECE = 8 * 1024 * 1024
MAX_FILES = 200
PHONE_HERE_FOR = 45  # seconds after the phone last asked, it counts as on the same network

CONFIG = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "butler", "pet.json")
STATE = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "butler", "link")

LOG = os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "butler", "link.log")
LOG_MAX = 512 * 1024

_print_lock = threading.Lock()
_log_lock = threading.Lock()


def log(line):
    """A line in ~/.local/state/butler/link.log, so a failed send can be looked into later. Never the token."""
    try:
        with _log_lock:
            os.makedirs(os.path.dirname(LOG), exist_ok=True)
            if os.path.exists(LOG) and os.path.getsize(LOG) > LOG_MAX:
                os.replace(LOG, LOG + ".1")
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + line + "\n")
    except OSError:
        pass  # a log that can't be written mustn't stop a send


def say(event, **fields):
    """One line of news for the pet (and the log, for anything but progress)."""
    with _print_lock:
        sys.stdout.write(json.dumps({"event": event, **fields}) + "\n")
        sys.stdout.flush()
    if event != "progress":
        log(json.dumps({"event": event, **{k: v for k, v in fields.items() if k != "paths"}, "count": len(fields.get("paths") or [])}))


def load_config():
    with open(CONFIG, encoding="utf-8") as f:
        config = json.load(f)
    if not config.get("url") or not config.get("token"):
        raise ValueError("set your save URL and token in ~/.config/butler/pet.json")
    return config


def downloads_dir():
    """~/Downloads/Butler, or wherever your Downloads folder really is."""
    try:
        out = subprocess.run(["xdg-user-dir", "DOWNLOAD"], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        out = ""
    base = out if out and out != os.path.expanduser("~") else os.path.expanduser("~/Downloads")
    return os.path.join(base, "Butler")


def safe_name(name):
    """One path part: no folders, no hidden files, nothing other systems refuse."""
    base = str(name or "").replace("\\", "/").split("/")[-1]
    clean = "".join("_" if (ord(c) < 32 or c in '<>:"|?*') else c for c in base).lstrip(". ").strip()
    if not clean:
        return "file"
    if len(clean) > 120:
        root, ext = os.path.splitext(clean)
        ext = ext if len(ext) <= 12 else ""
        clean = root[: 120 - len(ext)] + ext
    return clean


def free_path(folder, name):
    """`folder/name`, or `name (1)`, `name (2)`… if that's taken. Never overwrites."""
    root, ext = os.path.splitext(name)
    path, n = os.path.join(folder, name), 1
    while os.path.exists(path) or os.path.exists(path + ".part"):
        path = os.path.join(folder, f"{root} ({n}){ext}")
        n += 1
    return path


def describe(paths):
    """The files to send: name, size and type, refusing folders and things that aren't there."""
    files = []
    for p in paths:
        if not os.path.isfile(p):
            raise ValueError(f"{os.path.basename(p) or p} isn't a file (folders can't be sent yet)")
        files.append({
            "path": p,
            "name": safe_name(os.path.basename(p)),
            "size": os.path.getsize(p),
            "mime": mimetypes.guess_type(p)[0] or "application/octet-stream",
        })
    if not files:
        raise ValueError("nothing to send")
    if len(files) > MAX_FILES:
        raise ValueError(f"that's more than {MAX_FILES} files at once")
    return files


class Cancelled(Exception):
    pass


class Job:
    """One send or receive, with what the pet shows: names, count and bytes so far."""

    def __init__(self, job, direction, names, size, via, peer):
        self.job, self.direction, self.names, self.size, self.via, self.peer = job, direction, names, size, via, peer
        self.done = 0
        self.cancelled = False
        self._last = 0.0

    def add(self, n):
        self.done += n
        self.report()

    def report(self, force=False):
        now = time.monotonic()
        if not force and now - self._last < 0.4:
            return
        self._last = now
        say("progress", job=self.job, direction=self.direction, names=self.names[:5], count=len(self.names),
            done=self.done, size=self.size, via=self.via, peer=self.peer)

    def check(self):
        if self.cancelled:
            raise Cancelled()


jobs = {}
jobs_lock = threading.Lock()


def track(job):
    with jobs_lock:
        jobs[job.job] = job
    job.report(force=True)
    return job


def untrack(job):
    with jobs_lock:
        jobs.pop(job.job, None)


# --- the certificate ----------------------------------------------------------------------

def certificate():
    """This laptop's own certificate and key, made once. Returns (cert, key, SHA-256 fingerprint)."""
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    cert, key = os.path.join(STATE, "cert.pem"), os.path.join(STATE, "key.pem")
    if not (os.path.exists(cert) and os.path.exists(key)):
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
            "-nodes", "-days", "3650", "-subj", "/CN=Butler laptop", "-keyout", key, "-out", cert,
        ], check=True, capture_output=True, timeout=30)
        os.chmod(key, 0o600)
    with open(cert, encoding="ascii") as f:
        der = ssl.PEM_cert_to_DER_cert(f.read())
    return cert, key, hashlib.sha256(der).hexdigest()


def lan_addresses():
    """This laptop's IPv4 addresses on its networks, with each one's broadcast address."""
    found = []
    try:
        out = subprocess.run(["ip", "-4", "-j", "addr", "show", "up"], capture_output=True, text=True, timeout=5).stdout
        for link in json.loads(out or "[]"):
            if link.get("ifname") == "lo" or "LOOPBACK" in link.get("flags", []):
                continue
            for a in link.get("addr_info", []):
                if a.get("family") == "inet" and a.get("local"):
                    found.append((a["local"], a.get("broadcast")))
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    if not found:  # no `ip`: ask which address would be used to go out
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("10.255.255.255", 1))
                found.append((s.getsockname()[0], None))
        except OSError:
            pass
    return found


# --- the direct link: what the phone talks to on the same Wi-Fi ---------------------------

class Link:
    """Files waiting for the phone (offers) and files coming from it (pushes)."""

    def __init__(self, token):
        self.token = token
        self.phone_seen = 0.0
        self.phone_name = "phone"
        self.offers = {}      # id -> {"files": [...], "job": Job, "taken": set(), "event": Event}
        self.pushes = {}      # id -> {"files": {fid: {...}}, "job": Job}
        self.lock = threading.Lock()
        self.changed = threading.Condition(self.lock)

    def phone_here(self):
        return time.monotonic() - self.phone_seen < PHONE_HERE_FOR

    def offer(self, job, files):
        """Hands files to the phone the next time it asks. Waits until it has them all."""
        oid = str(uuid.uuid4())
        entry = {
            "files": [{"id": str(uuid.uuid4()), **f} for f in files],
            "job": job, "taken": set(), "served": {}, "event": threading.Event(),
        }
        with self.changed:
            self.offers[oid] = entry
            self.changed.notify_all()
        try:
            last, quiet_since = -1, time.monotonic()
            while not entry["event"].wait(1):
                job.check()
                if job.done != last:
                    last, quiet_since = job.done, time.monotonic()
                elif time.monotonic() - quiet_since > 90:
                    raise TimeoutError("your phone stopped answering on Wi-Fi")
        finally:
            with self.lock:
                self.offers.pop(oid, None)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ButlerLink/1"
    link: Link = None  # set before serving

    def log_message(self, *args):
        pass  # stdout is for the pet

    # -- helpers --

    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self):
        given = self.headers.get("x-butler-token", "")
        if hmac.compare_digest(given.encode(), self.link.token.encode()):
            name = self.headers.get("x-butler-device", "").strip()[:100]
            if name:
                self.link.phone_name = name
            return True
        log(f"refused {self.command} {self.path.split('?')[0]} from {self.client_address[0]}: wrong token")
        self._json(401, {"error": "bad token"})
        return False

    def _body_json(self):
        n = int(self.headers.get("content-length") or 0)
        if n > 1_000_000:
            raise ValueError("too big")
        return json.loads(self.rfile.read(n) or b"{}")

    def _route(self):
        url = urllib.parse.urlsplit(self.path)
        return [p for p in url.path.split("/") if p], dict(urllib.parse.parse_qsl(url.query))

    # -- methods --

    def do_GET(self):
        if not self._authorized():
            return
        parts, query = self._route()
        link = self.link
        if parts == ["link", "hello"]:
            return self._json(200, {"butler": 1, "device": "laptop"})
        if parts == ["link", "inbox"]:
            # The phone holds this open; files to hand over come back at once.
            wait = min(float(query.get("wait", "0") or 0), 25)
            until = time.monotonic() + wait
            with link.changed:
                link.phone_seen = time.monotonic()
                while True:
                    ready = [{"id": oid, "files": [{k: f[k] for k in ("id", "name", "size", "mime")} for f in o["files"]],
                              "size": sum(f["size"] for f in o["files"])}
                             for oid, o in link.offers.items()]
                    left = until - time.monotonic()
                    if ready or left <= 0:
                        break
                    link.changed.wait(left)
                link.phone_seen = time.monotonic()
            return self._json(200, ready)
        if len(parts) == 4 and parts[:2] == ["link", "offer"]:
            return self._serve_offer(parts[2], parts[3], int(query.get("from", "0") or 0))
        self._json(404, {"error": "not found"})

    def _serve_offer(self, oid, fid, start):
        with self.link.lock:
            offer = self.link.offers.get(oid)
        f = next((f for f in offer["files"] if f["id"] == fid), None) if offer else None
        if not f:
            return self._json(404, {"error": "that file isn't on offer any more"})
        job = offer["job"]
        start = max(0, min(start, f["size"]))
        self.send_response(200)
        self.send_header("content-type", "application/octet-stream")
        self.send_header("content-length", str(f["size"] - start))
        self.end_headers()
        # What the phone already had (a retry after a drop) counts once.
        before = offer["served"].get(fid, 0)
        if start > before:
            job.add(start - before)
        offer["served"][fid] = max(before, start)
        with open(f["path"], "rb") as src:
            src.seek(start)
            at = start
            while at < f["size"]:
                job.check()
                chunk = src.read(min(1024 * 1024, f["size"] - at))
                if not chunk:
                    break
                self.wfile.write(chunk)
                at += len(chunk)
                if at > offer["served"][fid]:
                    job.add(at - offer["served"][fid])
                    offer["served"][fid] = at

    def do_POST(self):
        if not self._authorized():
            return
        parts, _ = self._route()
        link = self.link
        try:
            body = self._body_json()
        except ValueError:
            return self._json(400, {"error": "bad request"})
        if parts == ["link", "push"]:
            return self._start_push(body)
        if len(parts) == 4 and parts[:2] == ["link", "push"] and parts[3] == "done":
            return self._finish_push(parts[2])
        if len(parts) == 4 and parts[:2] == ["link", "offer"] and parts[3] == "done":
            with link.lock:
                offer = link.offers.get(parts[2])
            if offer:
                offer["event"].set()
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not found"})

    def _start_push(self, body):
        files = body.get("files")
        if not isinstance(files, list) or not files or len(files) > MAX_FILES:
            return self._json(400, {"error": "files are required"})
        folder = downloads_dir()
        os.makedirs(folder, exist_ok=True)
        pid = str(uuid.uuid4())
        entry = {}
        try:
            for f in files:
                size = int(f.get("size"))
                if size < 0:
                    raise ValueError
                path = free_path(folder, safe_name(f.get("name")))
                open(path + ".part", "wb").close()  # claims the name
                entry[str(uuid.uuid4())] = {"name": os.path.basename(path), "size": size, "path": path}
        except (TypeError, ValueError):
            return self._json(400, {"error": "every file needs its size"})
        peer = str(body.get("from") or self.link.phone_name)[:100]
        job = track(Job(f"in-{pid}", "in", [f["name"] for f in entry.values()], sum(f["size"] for f in entry.values()), "wifi", peer))
        with self.link.lock:
            self.link.pushes[pid] = {"files": entry, "job": job, "touched": time.monotonic()}
        self._json(200, {"id": pid, "files": [{"id": fid, "name": f["name"]} for fid, f in entry.items()]})

    def do_PUT(self):
        if not self._authorized():
            return
        parts, query = self._route()
        if not (len(parts) == 4 and parts[:2] == ["link", "push"]):
            return self._json(404, {"error": "not found"})
        with self.link.lock:
            push = self.link.pushes.get(parts[2])
        f = push["files"].get(parts[3]) if push else None
        if not f:
            return self._json(404, {"error": "that transfer is gone"})
        job = push["job"]
        part = f["path"] + ".part"
        have = os.path.getsize(part) if os.path.exists(part) else 0
        offset = int(query.get("offset", "-1") or -1)
        length = int(self.headers.get("content-length") or 0)
        if offset != have:
            return self._json(409, {"error": "wrong offset", "received": have})
        if length > PIECE * 2 or have + length > f["size"]:
            return self._json(400, {"error": "that piece is bigger than it should be"})
        got = 0
        with open(part, "ab") as out:
            try:
                while got < length:
                    if job.cancelled:
                        raise Cancelled()
                    chunk = self.rfile.read(min(1024 * 1024, length - got))
                    if not chunk:
                        break
                    out.write(chunk)
                    got += len(chunk)
                    job.add(len(chunk))
            except (OSError, Cancelled):
                pass
            if got < length:  # cut off: keep only whole pieces, so the phone sends this one again
                out.truncate(have)
                job.add(-got)
                return self._json(409, {"error": "piece cut short", "received": have})
        push["touched"] = time.monotonic()
        if have + got == f["size"]:
            os.replace(part, f["path"])
        self._json(200, {"received": have + got})

    def _finish_push(self, pid):
        with self.link.lock:
            push = self.link.pushes.pop(pid, None)
        if not push:
            return self._json(404, {"error": "that transfer is gone"})
        paths = [f["path"] for f in push["files"].values()]
        missing = [os.path.basename(p) for p in paths if not os.path.exists(p)]
        untrack(push["job"])
        if missing:
            say("failed", job=push["job"].job, direction="in", error=f"{', '.join(missing)} didn't arrive whole")
            return self._json(400, {"error": "not every file arrived"})
        say("done", job=push["job"].job, direction="in", paths=paths, folder=os.path.dirname(paths[0]),
            via="wifi", peer=push["job"].peer)
        self._json(200, {"ok": True})


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # A phone that walked out of Wi-Fi range, or a stranger without the token: nothing to report.
        if not isinstance(sys.exc_info()[1], (OSError, ssl.SSLError)):
            log(f"error serving {client_address[0]}: {traceback.format_exc()}")
            super().handle_error(request, client_address)


def serve(link, cert, key):
    Handler.link = link
    server = Server(("0.0.0.0", LINK_PORT), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(cert, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def forget_stale_pushes(link):
    """A phone that vanished mid-send leaves .part files; after 10 quiet minutes they go."""
    while True:
        time.sleep(60)
        with link.lock:
            stale = [(pid, p) for pid, p in link.pushes.items() if time.monotonic() - p["touched"] > 600]
            for pid, _ in stale:
                link.pushes.pop(pid, None)
        for _, push in stale:
            for f in push["files"].values():
                try:
                    os.remove(f["path"] + ".part")
                except OSError:
                    pass
            untrack(push["job"])
            say("failed", job=push["job"].job, direction="in", error="your phone stopped sending")


def beacon(fingerprint):
    """Calls out "Butler's laptop is here" every few seconds, so the phone can find it."""
    message = json.dumps({"butler": 1, "port": LINK_PORT, "fp": fingerprint[:16], "device": "laptop"}).encode()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        while True:
            targets = {b for _, b in lan_addresses() if b} | {"255.255.255.255"}
            for target in targets:
                try:
                    s.sendto(message, (target, BEACON_PORT))
                except OSError:
                    pass  # no network right now
            time.sleep(3)


# --- through the Butler server ------------------------------------------------------------

class Remote:
    def __init__(self, config):
        self.base = config["url"].rstrip("/").removesuffix("/api/save")
        self.token = config["token"]

    def call(self, method, path, data=None, form=None, timeout=60):
        headers = {"x-butler-token": self.token}
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["content-type"] = "application/x-www-form-urlencoded"
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        return urllib.request.urlopen(request, timeout=timeout)

    def json(self, method, path, **kw):
        try:
            with self.call(method, path, **kw) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                body = json.loads(e.read() or b"{}")
            except ValueError:
                body = {}
            e.body = body
            raise


def with_retries(job, step, what):
    """Runs `step` until it works, waiting longer each time, for up to about ten minutes offline."""
    wait = 2
    for _ in range(12):
        job.check()
        try:
            return step()
        except urllib.error.HTTPError:
            raise
        except (OSError, TimeoutError):
            time.sleep(wait)
            wait = min(wait * 2, 60)
    raise ConnectionError(f"couldn't reach Butler to {what}")


def send_by_server(remote, job, target, files):
    started = remote.json("POST", "/api/transfer", form={
        "device": "laptop", "target": target,
        "files": json.dumps([{k: f[k] for k in ("name", "size", "mime")} for f in files]),
    })
    job.peer = ", ".join(started.get("sent_to", [])) or target
    tid = started["id"]
    try:
        for f, sent in zip(files, started["files"]):
            at = 0
            with open(f["path"], "rb") as src:
                while at < f["size"]:  # an empty file is already there, empty, on the server
                    job.check()
                    src.seek(at)
                    piece = src.read(min(PIECE, f["size"] - at))

                    def put():
                        return remote.json("PUT", f"/api/transfer/{tid}/{sent['id']}?offset={at}", data=piece, timeout=300)
                    try:
                        got = with_retries(job, put, "send")["received"]
                    except urllib.error.HTTPError as e:
                        if e.code != 409:
                            raise
                        got = int(e.body.get("received", at))  # it had more (or less) than we thought
                    job.add(got - at)
                    at = got
    except Cancelled:
        try:
            remote.json("DELETE", f"/api/transfer/{tid}")
        except (OSError, urllib.error.HTTPError):
            pass
        raise


def fetch_by_server(remote, job, transfer):
    """Downloads every file of a transfer into ~/Downloads/Butler while it's still arriving."""
    folder = downloads_dir()
    os.makedirs(folder, exist_ok=True)
    paths = []
    for f in transfer["files"]:
        path = free_path(folder, safe_name(f["name"]))
        part = path + ".part"
        open(part, "wb").close()
        size, quiet_since = int(f["size"]), time.monotonic()
        try:
            while os.path.getsize(part) < size:
                job.check()
                have = os.path.getsize(part)

                def get():
                    return remote.call("GET", f"/api/transfer/{transfer['id']}/{f['id']}?from={have}", timeout=120)
                try:
                    res = with_retries(job, get, "download")
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        raise ConnectionError("the other device stopped sending") from None
                    raise
                got = 0
                with res, open(part, "ab") as out:
                    while True:
                        job.check()
                        chunk = res.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                        got += len(chunk)
                        job.add(len(chunk))
                if got:
                    quiet_since = time.monotonic()
                elif time.monotonic() - quiet_since > 600:
                    raise TimeoutError("nothing new arrived for 10 minutes")
                else:
                    time.sleep(1)  # the sender hasn't got further yet
            os.replace(part, path)
            paths.append(path)
        except BaseException:
            try:
                os.remove(part)
            except OSError:
                pass
            raise
    try:
        remote.json("POST", f"/api/transfer/{transfer['id']}/done", form={"device": "laptop"})
    except (OSError, urllib.error.HTTPError):
        pass  # it's deleted after a day anyway
    return paths


# --- jobs ---------------------------------------------------------------------------------

def run_send(link, cmd):
    job_id = cmd.get("job") or str(uuid.uuid4())
    try:
        files = describe(cmd.get("paths") or [])
    except ValueError as e:
        say("failed", job=job_id, direction="out", error=str(e))
        return
    target = cmd.get("target") or "phone"
    job = track(Job(job_id, "out", [f["name"] for f in files], sum(f["size"] for f in files), "", target))
    try:
        if link and link.phone_here():
            job.via, job.peer = "wifi", link.phone_name
            job.report(force=True)
            link.offer(job, files)
        else:
            job.via = "server"
            job.report(force=True)
            send_by_server(Remote(load_config()), job, target, files)
        untrack(job)
        say("done", job=job_id, direction="out", paths=[f["path"] for f in files], via=job.via, peer=job.peer)
    except Cancelled:
        untrack(job)
        say("failed", job=job_id, direction="out", error="stopped")
    except urllib.error.HTTPError as e:
        untrack(job)
        say("failed", job=job_id, direction="out", error=getattr(e, "body", {}).get("error") or f"Butler answered {e.code}")
    except Exception as e:  # noqa: BLE001 - whatever it was, the pet says so
        untrack(job)
        log(traceback.format_exc())
        say("failed", job=job_id, direction="out", error=str(e) or e.__class__.__name__)


def run_fetch(cmd):
    transfer = cmd.get("transfer") or {}
    job_id = cmd.get("job") or f"in-{transfer.get('id')}"
    files = transfer.get("files") or []
    job = track(Job(job_id, "in", [f.get("name", "file") for f in files], int(transfer.get("size") or 0), "server",
                    cmd.get("from") or "your phone"))
    try:
        paths = fetch_by_server(Remote(load_config()), job, transfer)
        untrack(job)
        say("done", job=job_id, direction="in", paths=paths, folder=os.path.dirname(paths[0]) if paths else downloads_dir(),
            via="server", peer=job.peer)
    except Cancelled:
        untrack(job)
        say("failed", job=job_id, direction="in", error="stopped")
    except Exception as e:  # noqa: BLE001
        untrack(job)
        log(traceback.format_exc())
        say("failed", job=job_id, direction="in", error=str(e) or e.__class__.__name__)


def main():
    link = None
    try:
        config = load_config()
        cert, key, fingerprint = certificate()
        link = Link(config["token"])
        serve(link, cert, key)
        threading.Thread(target=beacon, args=(fingerprint,), daemon=True).start()
        threading.Thread(target=forget_stale_pushes, args=(link,), daemon=True).start()
        say("ready", local={"port": LINK_PORT, "fingerprint": fingerprint, "addresses": [a for a, _ in lan_addresses()]})
    except Exception as e:  # noqa: BLE001 - no direct link, but the server way still works
        say("ready", local=None, error=str(e) or e.__class__.__name__)

    for line in sys.stdin:
        try:
            cmd = json.loads(line)
        except ValueError:
            continue
        if cmd.get("cmd") == "send":
            threading.Thread(target=run_send, args=(link, cmd), daemon=True).start()
        elif cmd.get("cmd") == "fetch":
            threading.Thread(target=run_fetch, args=(cmd,), daemon=True).start()
        elif cmd.get("cmd") == "cancel":
            with jobs_lock:
                job = jobs.get(cmd.get("job"))
            if job:
                job.cancelled = True
        elif cmd.get("cmd") == "addresses":
            say("addresses", addresses=[a for a, _ in lan_addresses()])
    # stdin closed: the pet went away, so this goes too.


if __name__ == "__main__":
    main()
