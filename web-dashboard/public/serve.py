import http.server
import socketserver

PORT = 8080
Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
    '.apk': 'application/vnd.android.package-archive',
})

print(f"Serving APKs on port {PORT} with correct MIME types...")
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()
