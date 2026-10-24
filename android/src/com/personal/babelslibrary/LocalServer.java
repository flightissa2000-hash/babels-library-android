package com.personal.babelslibrary;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A tiny web server on 127.0.0.1 for the video and music players. WebView's own handling of seek requests
 * (byte ranges) breaks far into big files, so media is played from here instead. Only this phone can reach it, and
 * every address carries a random secret, so other apps can't read the library through it.
 */
final class LocalServer {
    private final File dir;
    private final String secret;
    private ServerSocket socket;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    LocalServer(File dir) {
        this.dir = dir;
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        secret = s.toString();
    }

    synchronized String base() throws IOException {
        if (socket == null || socket.isClosed()) {
            socket = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            final ServerSocket ss = socket;
            Thread t = new Thread(() -> {
                while (!ss.isClosed()) {
                    try {
                        Socket c = ss.accept();
                        pool.execute(() -> serve(c));
                    } catch (IOException ignored) { }
                }
            }, "babel-media");
            t.setDaemon(true);
            t.start();
        }
        return "http://127.0.0.1:" + socket.getLocalPort() + "/" + secret + "/";
    }

    private void serve(Socket c) {
        try (Socket sock = c) {
            sock.setSoTimeout(30000);
            BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.ISO_8859_1));
            OutputStream out = sock.getOutputStream();
            while (true) {                                  // keep-alive: several requests per connection
                String line = in.readLine();
                if (line == null || line.isEmpty()) return;
                String[] req = line.split(" ");
                String range = null;
                boolean close = false;
                String h;
                while ((h = in.readLine()) != null && !h.isEmpty()) {
                    String low = h.toLowerCase();
                    if (low.startsWith("range:")) range = h.substring(6).trim();
                    if (low.startsWith("connection:") && low.contains("close")) close = true;
                }
                if (req.length < 2) return;
                String path = URLDecoder.decode(req[1].split("\\?")[0], "UTF-8");
                String prefix = "/" + secret + "/";
                String name = path.startsWith(prefix) ? path.substring(prefix.length()) : "";
                File f = new File(dir, name);
                if (!name.matches("[A-Za-z0-9_.-]{1,80}") || !f.isFile()) {
                    out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
                    out.flush();
                    if (close) return;
                    continue;
                }
                long size = f.length(), start = 0, end = size - 1;
                boolean partial = false;
                if (range != null && range.startsWith("bytes=")) {
                    String[] ab = range.substring(6).split(",")[0].split("-", -1);
                    if (!ab[0].trim().isEmpty()) {
                        start = Long.parseLong(ab[0].trim());
                        if (ab.length > 1 && !ab[1].trim().isEmpty()) end = Math.min(Long.parseLong(ab[1].trim()), size - 1);
                    } else if (ab.length > 1 && !ab[1].trim().isEmpty()) {
                        start = Math.max(0, size - Long.parseLong(ab[1].trim()));
                    }
                    partial = true;
                }
                if (start >= size) {
                    out.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + size + "\r\nContent-Length: 0\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                    out.flush();
                    continue;
                }
                long len = end - start + 1;
                String head = (partial ? "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes " + start + "-" + end + "/" + size + "\r\n" : "HTTP/1.1 200 OK\r\n")
                        + "Content-Type: " + FilesProvider.typeFor(name) + "\r\nAccept-Ranges: bytes\r\nContent-Length: " + len
                        + "\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n\r\n";
                out.write(head.getBytes(StandardCharsets.ISO_8859_1));
                if ("GET".equals(req[0])) {
                    try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
                        raf.seek(start);
                        byte[] buf = new byte[256 * 1024];
                        long left = len;
                        while (left > 0) {
                            int n = raf.read(buf, 0, (int) Math.min(buf.length, left));
                            if (n <= 0) break;
                            out.write(buf, 0, n);
                            left -= n;
                        }
                    }
                }
                out.flush();
                if (close) return;
            }
        } catch (Exception ignored) {
            // the player stopped reading (seek, close): nothing to do
        }
    }
}
