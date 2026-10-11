"""개발용 정적 서버 — 브라우저 캐시를 끈다.

python -m http.server 는 캐시 금지 헤더를 보내지 않아, JS/CSS 를 고쳐도 브라우저가
예전 모듈을 계속 쓰는 일이 생긴다. 이 서버는 모든 응답에 no-cache 를 붙인다.

사용: python serve.py [포트]   (기본 8000)
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = Path(__file__).resolve().parent
    handler = partial(NoCacheHandler, directory=str(root))
    with ThreadingHTTPServer(('', port), handler) as httpd:
        print(f'ESC Culvert 개발 서버: http://localhost:{port}  (캐시 사용 안 함)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
