"""Tests for the laptop's file link (link.py): run with `python3 -m unittest desktop/gnome/test_link.py`.

Starts the real link in a throwaway home folder and talks to it the way the phone does:
over HTTPS, checking the certificate's fingerprint, with the Butler token.
"""

import hashlib
import http.client
import json
import os
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LINK = os.path.join(HERE, "butler-pet@anasmasama.dev", "link.py")
sys.path.insert(0, os.path.dirname(LINK))
import link  # noqa: E402


class Names(unittest.TestCase):
    def test_names_lose_folders_and_hidden_dots(self):
        self.assertEqual(link.safe_name("../../etc/passwd"), "passwd")
        self.assertEqual(link.safe_name("C:\\Users\\me\\a.jpg"), "a.jpg")
        self.assertEqual(link.safe_name(".bashrc"), "bashrc")
        self.assertEqual(link.safe_name(""), "file")
        self.assertEqual(len(link.safe_name("x" * 300 + ".jpeg")), 120)

    def test_a_taken_name_gets_a_number(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "a.jpg"), "w").close()
            open(os.path.join(d, "a (1).jpg.part"), "w").close()
            self.assertEqual(os.path.basename(link.free_path(d, "a.jpg")), "a (2).jpg")
            self.assertEqual(os.path.basename(link.free_path(d, "b.jpg")), "b.jpg")

    def test_folders_cant_be_sent(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                link.describe([d])
            with self.assertRaises(ValueError):
                link.describe([])


class DirectLink(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = tempfile.mkdtemp()
        os.makedirs(os.path.join(cls.home, ".config", "butler"))
        with open(os.path.join(cls.home, ".config", "butler", "pet.json"), "w") as f:
            json.dump({"url": "https://butler.invalid/api/save", "token": "secret-token"}, f)
        env = {**os.environ, "HOME": cls.home, "XDG_CONFIG_HOME": "", "XDG_DATA_HOME": ""}
        cls.proc = subprocess.Popen([sys.executable, LINK], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    text=True, env=env)
        cls.events = []
        ready = json.loads(cls.proc.stdout.readline())
        assert ready["event"] == "ready" and ready["local"], ready
        cls.fingerprint = ready["local"]["fingerprint"]
        threading.Thread(target=cls._read, daemon=True).start()

    @classmethod
    def _read(cls):
        for line in cls.proc.stdout:
            cls.events.append(json.loads(line))

    @classmethod
    def tearDownClass(cls):
        cls.proc.stdin.close()
        cls.proc.wait(5)
        cls.proc.stdout.close()

    def connect(self, fingerprint=None):
        """Like the phone: any certificate is accepted only if its fingerprint is the one Butler gave."""
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        conn = http.client.HTTPSConnection("127.0.0.1", link.LINK_PORT, context=context, timeout=10)
        conn.connect()
        der = conn.sock.getpeercert(binary_form=True)
        if hashlib.sha256(der).hexdigest() != (fingerprint or self.fingerprint):
            conn.close()
            raise ssl.SSLError("not your laptop")
        return conn

    def call(self, method, path, body=None, token="secret-token"):
        conn = self.connect()
        conn.request(method, path, body=body, headers={"x-butler-token": token, "x-butler-device": "test-phone"})
        res = conn.getresponse()
        data = res.read()
        conn.close()
        return res.status, data

    def wait_for(self, event, job_prefix):
        until = time.time() + 10
        while time.time() < until:
            for e in self.events:
                if e["event"] == event and e.get("job", "").startswith(job_prefix):
                    return e
            time.sleep(0.05)
        self.fail(f"no {event} for {job_prefix}: {self.events}")

    def test_the_fingerprint_is_the_certificates(self):
        self.connect()  # matches
        with self.assertRaises(ssl.SSLError):
            self.connect("00" * 32)

    def test_a_wrong_token_is_refused(self):
        self.assertEqual(self.call("GET", "/link/hello", token="nope")[0], 401)
        self.assertEqual(self.call("GET", "/link/hello")[0], 200)

    def test_the_phone_sends_files_in_pieces_and_a_drop_carries_on(self):
        data = os.urandom(300_000)
        status, body = self.call("POST", "/link/push", json.dumps(
            {"from": "test-phone", "files": [{"name": "../photo.jpg", "size": len(data)}]}))
        self.assertEqual(status, 200)
        started = json.loads(body)
        pid, fid = started["id"], started["files"][0]["id"]
        self.assertEqual(started["files"][0]["name"], "photo.jpg")
        self.assertEqual(self.call("PUT", f"/link/push/{pid}/{fid}?offset=0", data[:100_000])[0], 200)
        # The phone thinks the first piece was lost and sends it again: told where to carry on.
        status, body = self.call("PUT", f"/link/push/{pid}/{fid}?offset=0", data[:100_000])
        self.assertEqual((status, json.loads(body)["received"]), (409, 100_000))
        self.assertEqual(self.call("PUT", f"/link/push/{pid}/{fid}?offset=100000", data[100_000:])[0], 200)
        self.assertEqual(self.call("POST", f"/link/push/{pid}/done", b"{}")[0], 200)
        done = self.wait_for("done", f"in-{pid}")
        self.assertEqual(done["via"], "wifi")
        with open(done["paths"][0], "rb") as f:
            self.assertEqual(f.read(), data)
        self.assertTrue(done["paths"][0].startswith(os.path.join(self.home, "Downloads", "Butler")))

    def test_the_laptop_hands_files_to_the_phone_when_it_asks(self):
        path = os.path.join(self.home, "notes.txt")
        with open(path, "wb") as f:
            f.write(b"hello phone")
        # The phone is waiting on the link, so the laptop knows it's on the same Wi-Fi.
        got = {}
        waiting = threading.Thread(target=lambda: got.update(r=self.call("GET", "/link/inbox?wait=10")))
        waiting.start()
        time.sleep(0.5)
        self.proc.stdin.write(json.dumps({"cmd": "send", "job": "out-1", "target": "phone", "paths": [path]}) + "\n")
        self.proc.stdin.flush()
        waiting.join(10)
        offers = json.loads(got["r"][1])
        self.assertEqual(len(offers), 1)
        offer = offers[0]
        f = offer["files"][0]
        self.assertEqual((f["name"], f["size"]), ("notes.txt", 11))
        self.assertEqual(self.call("GET", f"/link/offer/{offer['id']}/{f['id']}?from=6")[1], b"phone")
        self.assertEqual(self.call("GET", f"/link/offer/{offer['id']}/{f['id']}?from=0")[1], b"hello phone")
        self.assertEqual(self.call("POST", f"/link/offer/{offer['id']}/done", b"{}")[0], 200)
        done = self.wait_for("done", "out-1")
        self.assertEqual(done["via"], "wifi")


if __name__ == "__main__":
    unittest.main()
