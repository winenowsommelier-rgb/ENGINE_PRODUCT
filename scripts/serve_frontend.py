#!/usr/bin/env python3
"""Serve the dependency-free frontend preview on port 3000."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', 3000), PreviewHandler)
    print('WineNow preview available at http://0.0.0.0:3000/preview/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopping preview server...')
    finally:
        server.server_close()
