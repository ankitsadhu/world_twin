"""Local dev server for the viewer: like `python3 -m http.server`, but tells the browser to revalidate
every file, so an edited .js / .json is never served stale from the browser cache.

  python3 scripts/tools/serve.py [port]
"""
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
