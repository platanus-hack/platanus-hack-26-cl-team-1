# Saves what the page POSTs ({name, b64 | text}) into a directory (owner: Anaís). Local capture tooling only.
# `name` is a file name or `<run>/<file>`: one level of subdirectory, [A-Za-z0-9_.-] only, nothing else.
#   python3 -I sim/cockpit/receiver.py <out dir>     (port 8765)
import base64
import http.server
import json
import pathlib
import re
import sys

OUT = pathlib.Path(sys.argv[1])
PART = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}$")


def target(name: str) -> pathlib.Path:
    parts = name.split("/")
    if not 1 <= len(parts) <= 2 or not all(PART.match(p) and ".." not in p for p in parts):
        raise ValueError(f"bad name {name!r}")
    path = OUT.joinpath(*parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        try:
            path = target(body["name"])
        except ValueError as error:
            self.send_response(400)
            self.cors()
            self.end_headers()
            self.wfile.write(str(error).encode())
            return
        path.write_bytes(base64.b64decode(body["b64"]) if "b64" in body else body["text"].encode())
        self.send_response(200)
        self.cors()
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8765), H).serve_forever()
