from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
class Preview(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
root=Path(__file__).resolve().parents[1]/'dist'
print('Legacy preview: http://127.0.0.1:4177/',flush=True)
Preview(('127.0.0.1',4177),partial(Handler,directory=str(root))).serve_forever()
