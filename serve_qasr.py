"""Tiny static server for the qasr/ build.

Serves the parent folder (so models/ and textures/ are reachable) and opens the
game page straight away. Independent of the project's own server.py.
"""
import functools, mimetypes, os, socket, webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8010
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = f"http://localhost:{PORT}/qasr/index.html"

for ext, mime in [(".js", "application/javascript"), (".css", "text/css"),
                  (".obj", "text/plain"), (".mtl", "text/plain"),
                  (".png", "image/png"), (".json", "application/json"),
                  (".webp", "image/webp")]:
    mimetypes.add_type(mime, ext)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if " 200 " not in msg:          # only surface problems
            super().log_message(fmt, *args)


def lan_ip():
    """The address this PC has on the local network, for playing on a phone."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))          # no packets are sent; this just picks a route
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def main():
    handler = functools.partial(Handler, directory=ROOT)
    httpd = HTTPServer(("", PORT), handler)
    print(f"  serving {ROOT}")
    print(f"  open    {PAGE}")
    ip = lan_ip()
    if ip:
        print(f"  phone   http://{ip}:{PORT}/qasr/index.html   (same Wi-Fi)")
    try:
        webbrowser.open(PAGE)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopping.")
        httpd.server_close()


if __name__ == "__main__":
    main()
