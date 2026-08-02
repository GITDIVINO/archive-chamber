#!/usr/bin/env python3
"""Starts the game on a free local port and opens it in a browser."""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from subprocess import run
from os import chdir

chdir(Path(__file__).parent)
server = ThreadingHTTPServer(("127.0.0.1", 0), SimpleHTTPRequestHandler)
url = f"http://127.0.0.1:{server.server_port}"
print(f"Game open: {url}\nKeep this window open while playing.\nPress Ctrl+C to stop.")
run(["open", url], check=False)

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nGame stopped.")
finally:
    server.server_close()
