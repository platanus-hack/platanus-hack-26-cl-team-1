# Saves what the page POSTs ({name, b64 | text}) into a directory (owner: Anaís). Local capture tooling only.
import base64, http.server, json, pathlib, sys
OUT = pathlib.Path(sys.argv[1])
class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "content-type"); self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        name = pathlib.Path(body["name"]).name
        data = base64.b64decode(body["b64"]) if "b64" in body else body["text"].encode()
        (OUT / name).write_bytes(data)
        self.send_response(200); self.cors(); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", 8765), H).serve_forever()
