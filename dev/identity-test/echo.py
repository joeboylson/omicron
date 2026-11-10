"""Tiny test page: shows the Tailscale identity headers that `tailscale serve`
adds to each request. Run inside the test VM."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class Echo(BaseHTTPRequestHandler):
    def do_GET(self):
        ts = {k: v for k, v in self.headers.items() if k.lower().startswith("tailscale-")}
        body = json.dumps({"from": self.client_address[0], "tailscale": ts}, indent=2).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

HTTPServer(("0.0.0.0", 8080), Echo).serve_forever()
