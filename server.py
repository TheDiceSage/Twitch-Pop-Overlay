import json
import os
import re
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


HOST = '127.0.0.1'
PORT = 8765
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'settings.js')


def read_settings():
    with open(SETTINGS_FILE, 'r', encoding='utf-8') as file:
        source = file.read()
    match = re.search(r'window\.OVERLAY_SETTINGS\s*=\s*(\{.*\})\s*;?\s*$', source, re.DOTALL)
    if not match:
        raise ValueError('settings.js does not contain a valid OVERLAY_SETTINGS object')
    return json.loads(match.group(1))


def write_settings(settings):
    contents = 'window.OVERLAY_SETTINGS = ' + json.dumps(settings, indent=2) + ';\n'
    directory = os.path.dirname(SETTINGS_FILE)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=directory, delete=False) as file:
        file.write(contents)
        temporary_file = file.name
    os.replace(temporary_file, SETTINGS_FILE)


class Handler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/settings':
            try:
                payload = json.dumps(read_settings()).encode('utf-8')
            except (OSError, ValueError, json.JSONDecodeError) as error:
                self.send_error(500, str(error))
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != '/api/settings':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            settings = json.loads(self.rfile.read(length))
            if not isinstance(settings, dict):
                raise ValueError('Settings must be a JSON object')
            write_settings(settings)
        except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
            self.send_error(400, str(error))
            return
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Overlay server running at http://{HOST}:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopping overlay server')
        server.server_close()