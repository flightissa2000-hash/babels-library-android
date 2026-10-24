"""Evaluates JavaScript in the app's WebView over the DevTools protocol (stdlib only).

    emu.ps1 forward                 # adb-forwards the WebView devtools socket to localhost:9334
    python cdp.py "Study.counts()"  # prints the JSON result (await is allowed)
"""
import base64
import json
import os
import socket
import struct
import sys
import urllib.request

PORT = 9334


def ws_connect(url):
    host_port, path = url[len("ws://"):].split("/", 1)
    host, port = host_port.split(":")
    s = socket.create_connection((host, int(port)), timeout=60)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += s.recv(4096)
    if b" 101 " not in resp.split(b"\r\n", 1)[0]:
        raise RuntimeError(resp.decode(errors="replace"))
    return s, resp.split(b"\r\n\r\n", 1)[1]


def ws_send(s, text):
    data = text.encode()
    head = bytearray([0x81])
    n = len(data)
    if n < 126:
        head.append(0x80 | n)
    elif n < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", n)
    mask = os.urandom(4)
    s.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


class Reader:
    def __init__(self, s, buf):
        self.s, self.buf = s, buf

    def need(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def message(self):
        parts = b""
        while True:
            b0, b1 = self.need(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self.need(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self.need(8))[0]
            payload = self.need(n)
            parts += payload
            if b0 & 0x80:
                return parts.decode()


def targets():
    """Page list; re-forwards the devtools socket and retries if adb dropped the forward."""
    import subprocess
    import time
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(f"http://localhost:{PORT}/json", timeout=10))
        except OSError:
            if attempt == 3:
                raise
            subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                            os.path.join(os.path.dirname(os.path.abspath(__file__)), "emu.ps1"), "forward"],
                           capture_output=True)
            time.sleep(1.5)


def evaluate(expr):
    ts = [t for t in targets() if t.get("type") == "page"]
    page = next((t for t in ts if "appassets" in t.get("url", "")), ts[0])
    s, rest = ws_connect(page["webSocketDebuggerUrl"])
    r = Reader(s, rest)
    ws_send(s, json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
        "expression": f"(async () => {{ return JSON.stringify(await (async () => ({expr}))()); }})()",
        "awaitPromise": True, "returnByValue": True, "userGesture": True}}))
    while True:
        msg = json.loads(r.message())
        if msg.get("id") == 1:
            res = msg["result"]
            if "exceptionDetails" in res:
                return "EXCEPTION: " + json.dumps(res["exceptionDetails"].get("exception", res["exceptionDetails"]), ensure_ascii=False)[:2000]
            v = res["result"].get("value")
            return v


if __name__ == "__main__":
    expr = sys.argv[1] if len(sys.argv) > 1 else "document.title"
    if expr.startswith("@"):
        expr = open(expr[1:], encoding="utf-8").read()
    out = evaluate(expr)
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        print(json.dumps(json.loads(out), ensure_ascii=False, indent=1))
    except Exception:
        print(out)

