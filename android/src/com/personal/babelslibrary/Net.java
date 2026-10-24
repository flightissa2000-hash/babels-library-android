package com.personal.babelslibrary;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Talks to Babel's Library on the computer. Tries the computer's address on the home Wi-Fi first; when that can't be
 * reached (cellular, another network) it uses the away-from-home address, which the computer posts to its private
 * ntfy.sh topic whenever it changes.
 */
final class Net {
    static volatile String lan = "";      // http://192.168.x.x:8766
    static volatile String remote = "";   // https://xxxx.trycloudflare.com (may change)
    static volatile String topic = "";    // ntfy.sh topic the computer posts its away-from-home address to
    static volatile String token = "";
    static volatile String current = "";  // whichever base answered last
    static volatile String via = "";      // "wifi" | "remote" | ""

    private Net() { }

    static final class Res {
        int status;
        byte[] body = new byte[0];
        String error = "";

        String text() { return new String(body, StandardCharsets.UTF_8); }
    }

    static Res once(String base, String method, String path, String json, int connectMs, int readMs) {
        Res r = new Res();
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + path).openConnection();
            c.setConnectTimeout(connectMs);
            c.setReadTimeout(readMs);
            c.setRequestMethod(method);
            c.setRequestProperty("Accept-Encoding", "identity");
            // the pairing token goes to the computer only (ntfy.sh refuses unknown tokens, and shouldn't see it)
            if (!token.isEmpty() && !base.startsWith("https://ntfy.sh")) c.setRequestProperty("Authorization", "Bearer " + token);
            if (json != null) {
                byte[] b = json.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(b.length);
                try (OutputStream o = c.getOutputStream()) { o.write(b); }
            }
            r.status = c.getResponseCode();
            InputStream in = r.status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) r.body = readAll(in);
        } catch (SocketTimeoutException e) {
            r.status = 0;
            r.error = "timeout";
        } catch (IOException e) {
            r.status = 0;
            r.error = String.valueOf(e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
        return r;
    }

    /** Send raw bytes (a piece of a file going to the computer) by whichever route works now. */
    static Res sendBytes(String path, byte[] data, int len) {
        String[] bases = {current, lan, remote};
        Res r = new Res();
        for (String base : bases) {
            if (base == null || base.isEmpty()) continue;
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(base + path).openConnection();
                c.setConnectTimeout(base.equals(lan) ? 2500 : 8000);
                c.setReadTimeout(120000);
                c.setRequestMethod("POST");
                c.setRequestProperty("Authorization", "Bearer " + token);
                c.setRequestProperty("Content-Type", "application/octet-stream");
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(len);
                try (OutputStream o = c.getOutputStream()) { o.write(data, 0, len); }
                r.status = c.getResponseCode();
                InputStream in = r.status >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in != null) r.body = readAll(in);
                if (r.status > 0 && r.status != 530 && r.status != 502) { current = base; via = base.equals(lan) ? "wifi" : "remote"; return r; }
            } catch (IOException e) {
                r.status = 0;
                r.error = String.valueOf(e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return r;
    }

    static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = i.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /** A request to the computer by whichever route works now. status 0 = couldn't reach it at all. */
    static synchronized Res call(String method, String path, String json) {
        Res r = null;
        if (!lan.isEmpty()) {
            r = once(lan, method, path, json, 2500, 60000);
            if (r.status > 0) { current = lan; via = "wifi"; return r; }
        }
        if (!remote.isEmpty()) {
            r = once(remote, method, path, json, 8000, 90000);
            if (r.status > 0 && r.status != 530 && r.status != 502) { current = remote; via = "remote"; return r; }
        }
        String fresh = lookupRemote();
        if (!fresh.isEmpty() && !fresh.equals(remote)) {
            remote = fresh;
            r = once(remote, method, path, json, 8000, 90000);
            if (r.status > 0 && r.status != 530 && r.status != 502) { current = remote; via = "remote"; return r; }
        }
        via = "";
        if (r == null) { r = new Res(); r.error = "not paired"; }
        if (r.status == 530 || r.status == 502) r.status = 0;
        return r;
    }

    /** The computer's latest away-from-home address, from its ntfy.sh topic (kept there for 12 hours). */
    static String lookupRemote() {
        if (topic.isEmpty()) return "";
        Res r = once("https://ntfy.sh", "GET", "/" + topic + "/json?poll=1&since=12h", null, 6000, 15000);
        if (r.status != 200) return "";
        String found = "";
        for (String line : r.text().split("\n")) {
            try {
                JSONObject o = new JSONObject(line);
                String m = o.optString("message", "");
                if ("message".equals(o.optString("event")) && m.startsWith("https://")) found = m.trim();
            } catch (Exception ignored) { }
        }
        return found;
    }

    /** Ask the Wi-Fi who is running Babel's Library (UDP broadcast; the computer answers with its name). */
    static JSONArray discover() {
        JSONArray out = new JSONArray();
        try (DatagramSocket s = new DatagramSocket()) {
            s.setBroadcast(true);
            s.setSoTimeout(400);
            byte[] q = "BABEL?".getBytes(StandardCharsets.US_ASCII);
            long end = System.currentTimeMillis() + 2200;
            int sent = 0;
            while (System.currentTimeMillis() < end) {
                if (sent < 3) {
                    s.send(new DatagramPacket(q, q.length, InetAddress.getByName("255.255.255.255"), 8767));
                    sent++;
                }
                try {
                    byte[] buf = new byte[512];
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    JSONObject o = new JSONObject(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                    String addr = "http://" + p.getAddress().getHostAddress() + ":" + o.optInt("port", 8766);
                    boolean dup = false;
                    for (int i = 0; i < out.length(); i++) if (out.getJSONObject(i).optString("url").equals(addr)) dup = true;
                    if (!dup) out.put(new JSONObject().put("url", addr).put("name", o.optString("name")));
                } catch (SocketTimeoutException ignored) { }
            }
        } catch (Exception ignored) { }
        return out;
    }
}
