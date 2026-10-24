package com.personal.babelslibrary;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.StatFs;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Babel's Library for Android. The app itself is a web page (assets/web) shown in a WebView from
 * https://appassets.androidplatform.net/; this class serves it, plus:
 *   /local/<name>          a downloaded file (with Range, so video and audio can seek)
 *   /cover/<id>?v=..       the item's cover, fetched from the computer once and kept small on the phone
 *   /comic/<name>/<n>      page n of a CBZ comic, read straight out of the zip
 * and gives the page a bridge ("Android") for the network, downloads and files.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/web/index.html";
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        String[][] m = {{"html", "text/html"}, {"js", "application/javascript"}, {"mjs", "application/javascript"}, {"css", "text/css"},
                {"json", "application/json"}, {"png", "image/png"}, {"jpg", "image/jpeg"}, {"jpeg", "image/jpeg"}, {"webp", "image/webp"},
                {"gif", "image/gif"}, {"avif", "image/avif"}, {"bmp", "image/bmp"}, {"svg", "image/svg+xml"}, {"woff2", "font/woff2"}, {"ttf", "font/ttf"},
                {"pdf", "application/pdf"}, {"epub", "application/epub+zip"}, {"cbz", "application/zip"}, {"mp3", "audio/mpeg"},
                {"flac", "audio/flac"}, {"m4a", "audio/mp4"}, {"ogg", "audio/ogg"}, {"wav", "audio/wav"}, {"mp4", "video/mp4"},
                {"m4v", "video/mp4"}, {"wasm", "application/wasm"}, {"webm", "video/webm"}, {"mkv", "video/x-matroska"}, {"mov", "video/quicktime"}};
        for (String[] p : m) MIME.put(p[0], p[1]);
    }

    private WebView web;
    private Dictation dictation;                 // speech to text for phone notes
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Map<String, List<String>> comicPages = new HashMap<>();
    private LocalServer media;

    static File libraryDir(Context c) {
        File d = c.getExternalFilesDir("library");
        if (d == null) d = new File(c.getFilesDir(), "library");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private File coverDir() {
        File d = new File(getCacheDir(), "covers");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(0xFFBFE7FF);
        web.addJavascriptInterface(new Bridge(), "Android");
        dictation = new Dictation(this, json -> js("window.Native && Native.dictation && Native.dictation(" + json + ")"));
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String p = u.getPath() == null ? "" : u.getPath();
                try {
                    if (p.startsWith("/local/")) return local(p.substring(7), req.getRequestHeaders());
                    if (p.startsWith("/part/")) return part(p.substring(6), u.getQueryParameter("s"), u.getQueryParameter("e"));
                    if (p.startsWith("/cover/")) return cover(p.substring(7), u.getQueryParameter("v"));
                    if (p.equals("/catcover")) return catCover(u.getEncodedQuery());
                    if (p.startsWith("/net/")) return net(p.substring(4) + (u.getEncodedQuery() != null ? "?" + u.getEncodedQuery() : ""), req.getRequestHeaders());
                    if (p.startsWith("/comic/")) return comic(p.substring(7));
                } catch (Exception e) {
                    return notFound();
                }
                return asset(p);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        if (BuildConfigDebug.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        setContentView(web);
        web.loadUrl(START);
        shared(getIntent());
    }

    // ------------------------------------------------------------------ sending files to the computer

    private static final int REQ_PICK = 7, REQ_PASSWORDS = 8;
    /** Android 13+: ask once to show notifications (the upload progress and its Cancel button live there). */
    private void askToNotify() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 9);
    }

    private void askToNotifyIf(boolean on) { if (on) runOnUiThread(this::askToNotify); }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        shared(i);
    }

    /** "Share → Babel's Library" from another app: the files go to the computer's library. */
    private void shared(Intent i) {
        if (i == null) return;
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(i.getAction())) {
            ArrayList<Uri> list = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        } else {
            return;
        }
        if (uris.isEmpty() && i.getClipData() != null)        // some apps share through the clip data only
            for (int k = 0; k < i.getClipData().getItemCount(); k++) if (i.getClipData().getItemAt(k).getUri() != null) uris.add(i.getClipData().getItemAt(k).getUri());
        if (uris.isEmpty() && i.getData() != null) uris.add(i.getData());
        if (!uris.isEmpty()) { askToNotify(); UploadService.add(this, uris); }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_PASSWORDS) {          // a password export picked to import: read it, encrypt it, then report back
            if (res != RESULT_OK || data == null || data.getData() == null) { js("window.Native && Native.pwImported && Native.pwImported(null)"); return; }
            final Uri u = data.getData();
            pool.execute(() -> {
                String msg;
                try (java.io.InputStream in = getContentResolver().openInputStream(u)) {
                    int[] r = Passwords.importCsv(this, new String(Net.readAll(in), StandardCharsets.UTF_8));
                    msg = new JSONObject().put("added", r[0]).put("updated", r[1]).put("skipped", r[2]).put("total", Passwords.all(this).size()).toString();
                } catch (Exception e) {
                    try { msg = new JSONObject().put("error", e.getMessage() == null ? "Couldn't read that file." : e.getMessage()).toString(); } catch (Exception x) { msg = "{}"; }
                }
                js("window.Native && Native.pwImported && Native.pwImported(" + msg + ")");
            });
            return;
        }
        if (req != REQ_PICK || res != RESULT_OK || data == null) return;
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int k = 0; k < data.getClipData().getItemCount(); k++) uris.add(data.getClipData().getItemAt(k).getUri());
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        if (!uris.isEmpty()) UploadService.add(this, uris);
    }

    // ------------------------------------------------------------------ what the WebView loads

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
    }

    private static String mimeOf(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
        return MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
    }

    private WebResourceResponse asset(String path) {
        String p = path.startsWith("/") ? path.substring(1) : path;
        if (p.contains("..")) return notFound();
        try {
            InputStream in = getAssets().open(p, AssetManager.ACCESS_STREAMING);
            String mime = mimeOf(p);
            WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("text") || mime.endsWith("json") || mime.endsWith("javascript") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "no-cache");
            r.setResponseHeaders(h);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private static boolean okName(String n) {
        return n != null && n.matches("[A-Za-z0-9_.-]{1,80}");
    }

    /** A downloaded file, honouring Range so the video player can seek. */
    private WebResourceResponse local(String name, Map<String, String> headers) throws IOException {
        name = Uri.decode(name);
        if (!okName(name)) return notFound();
        File f = new File(libraryDir(this), name);
        if (!f.isFile()) return notFound();
        long size = f.length(), start = 0, end = size - 1;
        String range = null;
        for (Map.Entry<String, String> e : headers.entrySet()) if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
        int code = 200;
        if (range != null && range.startsWith("bytes=")) {
            String[] ab = range.substring(6).split(",")[0].split("-", -1);
            if (!ab[0].isEmpty()) {
                start = Long.parseLong(ab[0].trim());
                if (ab.length > 1 && !ab[1].trim().isEmpty()) end = Math.min(Long.parseLong(ab[1].trim()), size - 1);
            } else if (ab.length > 1 && !ab[1].isEmpty()) {
                start = Math.max(0, size - Long.parseLong(ab[1].trim()));
            }
            code = 206;
        }
        if (start >= size) start = Math.max(0, size - 1);
        final long len = end - start + 1;
        java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r");
        raf.seek(start);
        InputStream fin = java.nio.channels.Channels.newInputStream(raf.getChannel());
        InputStream in = new FilterInputStream(fin) {   // hand out exactly the requested bytes
            long left = len;
            @Override public int read() throws IOException { if (left <= 0) return -1; int b = super.read(); if (b >= 0) left--; return b; }
            @Override public int read(byte[] b, int o, int n) throws IOException {
                if (left <= 0) return -1;
                int k = super.read(b, o, (int) Math.min(n, left));
                if (k > 0) left -= k;
                return k;
            }
        };
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Content-Length", String.valueOf(len));
        // never cached: WebView would otherwise keep part of a big file and answer later ranges from that broken copy
        h.put("Cache-Control", "no-store");
        h.put("Access-Control-Allow-Origin", "*");
        if (code == 206) h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        return new WebResourceResponse(mimeOf(name), null, code, code == 206 ? "Partial Content" : "OK", h, in);
    }

    /** Bytes s..e-1 of a downloaded file as an ordinary answer (the PDF reader asks for pieces this way: WebView
     *  refuses its own Range answers far into big files). */
    private WebResourceResponse part(String name, String s, String e) throws IOException {
        name = Uri.decode(name);
        if (!okName(name) || s == null || e == null) return notFound();
        File f = new File(libraryDir(this), name);
        if (!f.isFile()) return notFound();
        long start = Math.max(0, Long.parseLong(s)), end = Math.min(Long.parseLong(e), f.length());
        byte[] buf = new byte[(int) Math.max(0, end - start)];
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r")) {
            raf.seek(start);
            raf.readFully(buf);
        }
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("X-File-Size", String.valueOf(f.length()));
        h.put("Access-Control-Expose-Headers", "X-File-Size");
        return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, new ByteArrayInputStream(buf));
    }

    /** The cover: from the phone's cache, else fetched from the computer and shrunk to phone size. */
    private WebResourceResponse cover(String id, String v) throws IOException {
        if (!id.matches("\\d{1,9}")) return notFound();
        String tag = v == null ? "0" : v.replaceAll("[^0-9A-Za-z]", "");
        File f = new File(coverDir(), id + "_" + tag + ".jpg");
        if (!f.isFile()) {
            String[] bases = {Net.current, Net.lan, Net.remote};
            Net.Res r = null;
            for (String b : bases) {
                if (b == null || b.isEmpty()) continue;
                r = Net.once(b, "GET", "/sync/cover/" + id, null, 2500, 30000);
                if (r.status == 200) break;
            }
            if (r == null || r.status != 200) return notFound();
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(r.body, 0, r.body.length, o);
            int sample = 1;
            while (o.outWidth / (sample * 2) >= 360) sample *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            Bitmap bmp = BitmapFactory.decodeByteArray(r.body, 0, r.body.length, o);
            if (bmp == null) return notFound();
            if (bmp.getWidth() > 420) bmp = Bitmap.createScaledBitmap(bmp, 420, Math.round(bmp.getHeight() * 420f / bmp.getWidth()), true);
            File[] old = coverDir().listFiles((d, n) -> n.startsWith(id + "_"));
            if (old != null) for (File x : old) x.delete();
            try (FileOutputStream out = new FileOutputStream(f)) { bmp.compress(Bitmap.CompressFormat.JPEG, 82, out); }
        }
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "max-age=31536000");
        return new WebResourceResponse("image/jpeg", null, 200, "OK", h, new FileInputStream(f));
    }

    /** A catalogue cover (a book that isn't in the library), through the computer, which fetches and keeps them. */
    private WebResourceResponse catCover(String query) {
        if (query == null) return notFound();
        String[] bases = {Net.current, Net.lan, Net.remote};
        for (String b : bases) {
            if (b == null || b.isEmpty()) continue;
            Net.Res r = Net.once(b, "GET", "/sync/cat/cover?" + query, null, 2500, 30000);
            if (r.status == 200 && r.body != null && r.body.length > 0) {
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "max-age=604800");
                return new WebResourceResponse("image/jpeg", null, 200, "OK", h, new ByteArrayInputStream(r.body));
            }
            if (r.status == 404) break;
        }
        return notFound();
    }

    /** /net/<path>: a GET from the computer with the pairing token (the reader's subtitles and audiobook chapters
     *  stream through here; Range is passed along so audio can seek). */
    private WebResourceResponse net(String path, Map<String, String> headers) {
        if (!path.startsWith("/sync/")) return notFound();
        String range = null;
        for (Map.Entry<String, String> e : headers.entrySet()) if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
        for (String b : new String[]{Net.current, Net.lan, Net.remote}) {
            if (b == null || b.isEmpty()) continue;
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(b + path).openConnection();
                c.setConnectTimeout(b.equals(Net.lan) ? 2500 : 8000);
                c.setReadTimeout(60000);
                c.setRequestProperty("Authorization", "Bearer " + Net.token);
                c.setRequestProperty("Accept-Encoding", "identity");
                if (range != null) c.setRequestProperty("Range", range);
                int st = c.getResponseCode();
                if (st == 502 || st == 530) { c.disconnect(); continue; }
                Map<String, String> h = new HashMap<>();
                for (String k : new String[]{"Content-Range", "Content-Length", "Accept-Ranges"}) if (c.getHeaderField(k) != null) h.put(k, c.getHeaderField(k));
                h.put("Cache-Control", "no-store");
                h.put("Access-Control-Allow-Origin", "*");
                String type = c.getContentType() == null ? "application/octet-stream" : c.getContentType().split(";")[0];
                InputStream in = st >= 400 ? c.getErrorStream() : c.getInputStream();
                return new WebResourceResponse(type, type.startsWith("text") || type.contains("json") ? "utf-8" : null, st,
                        st == 206 ? "Partial Content" : st < 300 ? "OK" : "Error", h, in == null ? new ByteArrayInputStream(new byte[0]) : in);
            } catch (IOException ignored) { }
        }
        return new WebResourceResponse("text/plain", "utf-8", 503, "Offline", null, new ByteArrayInputStream(new byte[0]));
    }

    private static final java.util.regex.Pattern IMG =java.util.regex.Pattern.compile("(?i).*\\.(jpe?g|png|webp|gif|bmp|avif)$");

    private static int natural(String a, String b) {
        int i = 0, j = 0;
        while (i < a.length() && j < b.length()) {
            char x = a.charAt(i), y = b.charAt(j);
            if (Character.isDigit(x) && Character.isDigit(y)) {
                int si = i, sj = j;
                while (i < a.length() && Character.isDigit(a.charAt(i))) i++;
                while (j < b.length() && Character.isDigit(b.charAt(j))) j++;
                String na = a.substring(si, i).replaceFirst("^0+(?=.)", ""), nb = b.substring(sj, j).replaceFirst("^0+(?=.)", "");
                if (na.length() != nb.length()) return na.length() - nb.length();
                int c = na.compareTo(nb);
                if (c != 0) return c;
            } else {
                int c = Character.compare(Character.toLowerCase(x), Character.toLowerCase(y));
                if (c != 0) return c;
                i++;
                j++;
            }
        }
        return (a.length() - i) - (b.length() - j);
    }

    private synchronized List<String> pagesOf(String name) throws IOException {
        List<String> pages = comicPages.get(name);
        if (pages != null) return pages;
        pages = new ArrayList<>();
        try (ZipFile z = new ZipFile(new File(libraryDir(this), name))) {
            Enumeration<? extends ZipEntry> en = z.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                String n = e.getName();
                String leaf = n.substring(n.lastIndexOf('/') + 1);
                if (!e.isDirectory() && IMG.matcher(n).matches() && !n.startsWith("__MACOSX") && !leaf.startsWith(".")) pages.add(n);
            }
        }
        Collections.sort(pages, MainActivity::natural);
        comicPages.put(name, pages);
        return pages;
    }

    /** /comic/<name>/count (JSON) or /comic/<name>/<n> (the image). */
    private static final Object ZIP_LOCK = new Object();
    private static ZipFile openZip;
    private static String openZipName;

    private WebResourceResponse comic(String rest) throws IOException {
        int slash = rest.indexOf('/');
        if (slash < 0) return notFound();
        String name = Uri.decode(rest.substring(0, slash)), what = rest.substring(slash + 1);
        if (!okName(name) || !new File(libraryDir(this), name).isFile()) return notFound();
        List<String> pages = pagesOf(name);
        if ("count".equals(what)) {
            byte[] b = ("{\"count\":" + pages.size() + "}").getBytes(StandardCharsets.UTF_8);
            return new WebResourceResponse("application/json", "utf-8", new ByteArrayInputStream(b));
        }
        int n = Integer.parseInt(what);
        if (n < 0 || n >= pages.size()) return notFound();
        byte[] data;
        synchronized (ZIP_LOCK) {          // the archive stays open while you read (opening it for every page was slow)
            if (openZip == null || !name.equals(openZipName)) {
                if (openZip != null) try { openZip.close(); } catch (IOException ignored) { }
                openZip = new ZipFile(new File(libraryDir(this), name));
                openZipName = name;
            }
            data = Net.readAll(openZip.getInputStream(openZip.getEntry(pages.get(n))));
        }
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "max-age=86400");
        return new WebResourceResponse(mimeOf(pages.get(n)), null, 200, "OK", h, new ByteArrayInputStream(data));
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        fullScreen(this);
        js("window.Native && Native.onResume()");
        if (NewsAlerts.on(this)) {
            NewsAlerts.schedule(this);
            pool.execute(() -> { try { NewsAlerts.check(this); } catch (Exception ignored) { } });
        }
        if (BrowserActivity.toStart) { BrowserActivity.toStart = false; js("window.setTab && setTab('browser')"); }   // (the browser's ✕: its start page)
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (!focus) return;
        fullScreen(this);
        // how far down the camera hole reaches, so the app's own top bar (with its clock) starts below it
        View d = getWindow().getDecorView();
        int cut = 0;
        if (d.getRootWindowInsets() != null && d.getRootWindowInsets().getDisplayCutout() != null)
            cut = d.getRootWindowInsets().getDisplayCutout().getSafeInsetTop();
        float px = cut / getResources().getDisplayMetrics().density;
        js("document.documentElement.style.setProperty('--cut','" + px + "px')");
    }

    /** No phone status bar while in the app (a swipe from the top shows it for a moment); the app shows its own clock. */
    @SuppressWarnings("deprecation")
    static void fullScreen(Activity a) {
        android.view.Window w = a.getWindow();
        if (Build.VERSION.SDK_INT >= 28) {
            // draw up into the camera strip; without setAttributes Android ignores this and letterboxes it (a white band)
            WindowManager.LayoutParams lp = w.getAttributes();
            int mode = Build.VERSION.SDK_INT >= 30 ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            if (lp.layoutInDisplayCutoutMode != mode) { lp.layoutInDisplayCutoutMode = mode; w.setAttributes(lp); }
        }
        w.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0xFF1D2021));
        if (Build.VERSION.SDK_INT >= 30) {
            // draw edge to edge (otherwise the window keeps a band clear of the camera hole); the page itself starts below
            // the hole (--cut), and the gesture bar and keyboard get room at the bottom here
            w.setDecorFitsSystemWindows(false);
            View content = a.findViewById(android.R.id.content);
            if (content != null) content.setOnApplyWindowInsetsListener((v, in) -> {
                android.graphics.Insets b = in.getInsets(android.view.WindowInsets.Type.navigationBars() | android.view.WindowInsets.Type.ime());
                v.setPadding(0, 0, 0, b.bottom);
                return in;
            });
            android.view.WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(android.view.WindowInsets.Type.statusBars());
                c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    protected void onPause() {
        js("window.Native && Native.onPause()");
        if (dictation != null) dictation.stop();          // the microphone is never left on in the background
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (dictation != null) dictation.destroy();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == Dictation.REQ && dictation != null)
            dictation.permissionResult(results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.Native ? Native.onBack() : false", v -> {
            if (!"true".equals(v)) MainActivity.super.onBackPressed();
        });
    }

    private void js(final String code) {
        if (web != null) runOnUiThread(() -> web.evaluateJavascript(code, null));
    }

    private void done(String id, int status, String text, String extra) {
        js("window.Native && Native.done(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text == null ? "" : text)
                + "," + JSONObject.quote(extra == null ? "" : extra) + ")");
    }

    // ------------------------------------------------------------------ JavaScript bridge

    private class Bridge {
        // dictation into notes: it listens from dictateStart() until dictateStop(); the words arrive at Native.dictation
        @JavascriptInterface
        public void dictateStart() { dictation.start(); }

        @JavascriptInterface
        public void dictateStop() { dictation.stop(); }

        // app state (library, pending changes, settings) as JSON files in private storage
        @JavascriptInterface
        public String load(String name) {
            File f = stateFile(name);
            if (f == null || !f.exists()) return "";
            try (FileInputStream in = new FileInputStream(f)) {
                return new String(Net.readAll(in), StandardCharsets.UTF_8);
            } catch (IOException e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean save(String name, String data) {
            File f = stateFile(name);
            if (f == null) return false;
            File tmp = new File(f.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(data.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            } catch (IOException e) {
                return false;
            }
            return tmp.renameTo(f);
        }

        private File stateFile(String name) {
            if (name == null || !name.matches("[A-Za-z0-9_.-]{1,64}")) return null;
            return new File(getFilesDir(), name);
        }

        @JavascriptInterface
        public void setConn(String json) {
            try {
                JSONObject o = new JSONObject(json);
                Net.lan = o.optString("lan", "");
                Net.remote = o.optString("remote", "");
                Net.topic = o.optString("topic", "");
                Net.token = o.optString("token", "");
                Net.current = "";       // the addresses changed: find the route that works again
                NewsAlerts.keepConn(MainActivity.this, o);
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public String route() {
            return Net.via;
        }

        @JavascriptInterface
        public String remoteNow() {
            return Net.remote;
        }

        /** A request to the computer; the answer arrives as Native.done(id, status, body, route). */
        @JavascriptInterface
        public void request(final String id, final String method, final String path, final String body) {
            pool.execute(() -> {
                Net.Res r = Net.call(method, path, body == null || body.isEmpty() ? null : body);
                done(id, r.status, r.status > 0 ? r.text() : r.error, Net.via);
            });
        }

        /** Pairing: straight to the address given, no token yet. */
        @JavascriptInterface
        public void pair(final String id, final String base, final String body) {
            pool.execute(() -> {
                String t = Net.token;
                Net.token = "";
                Net.Res r = Net.once(base, "POST", "/sync/pair", body, 4000, 20000);
                Net.token = t;
                done(id, r.status, r.status > 0 ? r.text() : r.error, "");
            });
        }

        @JavascriptInterface
        public void hello(final String id, final String base) {
            pool.execute(() -> {
                Net.Res r = Net.once(base, "GET", "/sync/hello", null, 3000, 6000);
                done(id, r.status, r.status > 0 ? r.text() : r.error, "");
            });
        }

        @JavascriptInterface
        public void discover(final String id) {
            pool.execute(() -> done(id, 200, Net.discover().toString(), ""));
        }

        @JavascriptInterface
        public String deviceName() {
            return Build.MANUFACTURER.substring(0, 1).toUpperCase() + Build.MANUFACTURER.substring(1) + " " + Build.MODEL;
        }

        @JavascriptInterface
        public String network() {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkCapabilities c = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
            if (c == null) return "none";
            if (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "wifi";
            if (c.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
            return "other";
        }

        // ---- files on the phone
        @JavascriptInterface
        public String files() {
            JSONObject o = new JSONObject();
            File[] fs = libraryDir(MainActivity.this).listFiles();
            if (fs != null) for (File f : fs) {
                try { if (f.isFile()) o.put(f.getName(), f.length()); } catch (Exception ignored) { }
            }
            return o.toString();
        }

        @JavascriptInterface
        public boolean deleteFile(String name) {
            if (!okName(name)) return false;
            synchronized (MainActivity.this) { comicPages.remove(name); }
            return new File(libraryDir(MainActivity.this), name).delete();
        }

        @JavascriptInterface
        public long freeSpace() {
            StatFs s = new StatFs(libraryDir(MainActivity.this).getPath());
            return s.getAvailableBytes();
        }

        @JavascriptInterface
        public boolean openWith(String name) {
            if (!okName(name) || !new File(libraryDir(MainActivity.this), name).isFile()) return false;
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(FilesProvider.uriFor(name), FilesProvider.typeFor(name));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                startActivity(Intent.createChooser(i, "Open with"));
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            }
        }

        // ---- files going to the computer (UploadService)
        @JavascriptInterface
        public String uploads() { return UploadService.json(); }

        @JavascriptInterface
        public void cancelUpload(String id) { UploadService.cancel(id); }

        @JavascriptInterface
        public void dismissUpload(String id) { UploadService.dismiss(id); }

        @JavascriptInterface
        public void retryUpload(String id) { UploadService.retry(MainActivity.this, id); }

        /** Choose files on the phone to add to the computer's library. */
        @JavascriptInterface
        public void pickFiles() {
            askToNotify();
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            runOnUiThread(() -> startActivityForResult(i, REQ_PICK));
        }

        // ---- the browser's own saved passwords (imported from a CSV export; encrypted in the phone's keystore)
        @JavascriptInterface
        public void importPasswords() {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/csv", "text/comma-separated-values", "text/plain", "application/csv", "application/octet-stream"});
            runOnUiThread(() -> startActivityForResult(i, REQ_PASSWORDS));
        }

        @JavascriptInterface
        public int passwordCount() { return Passwords.all(MainActivity.this).size(); }

        @JavascriptInterface
        public void clearPasswords() { Passwords.clear(MainActivity.this); }

        // ---- News: notifications for new events (the computer finds them; this phone shows them)
        @JavascriptInterface
        public void setNewsAlerts(boolean on) {
            askToNotifyIf(on);
            NewsAlerts.set(MainActivity.this, on);
            if (on) pool.execute(() -> { try { NewsAlerts.check(MainActivity.this); } catch (Exception ignored) { } });
        }

        @JavascriptInterface
        public boolean newsAlerts() { return NewsAlerts.on(MainActivity.this); }

        // ---- bookmarks (☆ in the browser): a copy of the computer's list, kept here for when it can't be reached
        @JavascriptInterface
        public String bookmarks() { return BrowserActivity.readBookmarks(MainActivity.this); }

        @JavascriptInterface
        public void setBookmarks(String json) { BrowserActivity.writeBookmarks(MainActivity.this, json); }

        // ---- the browser
        @JavascriptInterface
        public void openBrowser(String url) {
            Intent i = new Intent(MainActivity.this, BrowserActivity.class);
            i.putExtra(BrowserActivity.EXTRA_URL, url == null ? "" : url);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);         // (its own task: an open page waits there while you're in the app)
            runOnUiThread(() -> startActivity(i));
        }

        /** The page left open in the browser ({url, title}), or "" when there isn't one. */
        @JavascriptInterface
        public String browserOpen() {
            android.content.SharedPreferences p = getSharedPreferences("browser", MODE_PRIVATE);
            String u = p.getString("open_url", "");
            if (u.isEmpty()) return "";
            try { return new JSONObject().put("url", u).put("title", p.getString("open_title", "")).put("alive", BrowserActivity.alive).toString(); } catch (Exception e) { return ""; }
        }

        /** The page's theme colours, for the browser screen's bar (it's native, so it can't read the CSS). */
        @JavascriptInterface
        public void setBrowserTheme(String json) {
            if (json != null && json.length() < 4000)
                getSharedPreferences("browser", MODE_PRIVATE).edit().putString("theme", json).apply();
        }

        @JavascriptInterface
        public String browserHistory() { return BrowserActivity.readHistory(MainActivity.this); }

        @JavascriptInterface
        public boolean setBrowserHistory(String json) { return BrowserActivity.writeHistory(MainActivity.this, json); }

        /** Fetch the computer's ad and tracker block lists for the browser (about 1 MB, compressed). */
        @JavascriptInterface
        public void updateAdblock(final String id) {
            pool.execute(() -> {
                Net.Res r = Net.call("GET", "/sync/adblock", null);
                if (r.status == 200 && r.body.length > 1000) {
                    try (FileOutputStream out = new FileOutputStream(BrowserActivity.blockFile(MainActivity.this))) {
                        out.write(r.body);
                    } catch (IOException e) {
                        done(id, 0, e.getMessage(), "");
                        return;
                    }
                    BrowserActivity.forgetBlocklist();
                }
                done(id, r.status, String.valueOf(r.body.length), Net.via);
            });
        }

        @JavascriptInterface
        public long adblockAge() {
            File f = BrowserActivity.blockFile(MainActivity.this);
            return f.isFile() ? f.lastModified() / 1000 : 0;
        }

        /** Where the video/music players read a downloaded file (the in-app media server). */
        @JavascriptInterface
        public String mediaUrl(String name) {
            if (!okName(name)) return "";
            try {
                if (media == null) media = new LocalServer(libraryDir(MainActivity.this));
                return media.base() + Uri.encode(name);
            } catch (IOException e) {
                return "";
            }
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        // ---- downloads from the computer (Android's download manager: keeps going in the background, resumes,
        //      works on Wi-Fi and cellular, shows progress in the notification shade)
        @JavascriptInterface
        public void download(final String id, final int itemId, final String name, final String title) {
            pool.execute(() -> {
                if (!okName(name)) { done(id, 0, "bad name", ""); return; }
                Net.Res r = Net.call("GET", "/sync/hello", null);       // picks the route that works right now
                if (r.status != 200) { done(id, 0, "Can't reach your computer right now.", ""); return; }
                File dest = new File(libraryDir(MainActivity.this), name);
                if (dest.exists()) dest.delete();
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                DownloadManager.Request q = new DownloadManager.Request(Uri.parse(Net.current + "/sync/file/" + itemId));
                q.addRequestHeader("Authorization", "Bearer " + Net.token);
                q.setTitle(title == null || title.isEmpty() ? name : title);
                q.setDescription("From your computer · Babel's Library");
                q.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
                q.setAllowedOverMetered(true);
                q.setAllowedOverRoaming(true);
                q.setDestinationInExternalFilesDir(MainActivity.this, "library", name);
                long dl = dm.enqueue(q);
                done(id, 200, String.valueOf(dl), Net.via);
            });
        }

        /** Progress of downloads: {downloadId: {state, done, total, reason}} */
        @JavascriptInterface
        public String downloads(String idsJson) {
            JSONObject out = new JSONObject();
            try {
                JSONArray ids = new JSONArray(idsJson);
                if (ids.length() == 0) return "{}";
                long[] arr = new long[ids.length()];
                for (int i = 0; i < arr.length; i++) arr[i] = ids.getLong(i);
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(arr))) {
                    while (c.moveToNext()) {
                        int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        String state = st == DownloadManager.STATUS_SUCCESSFUL ? "done" : st == DownloadManager.STATUS_FAILED ? "failed"
                                : st == DownloadManager.STATUS_PAUSED ? "paused" : st == DownloadManager.STATUS_PENDING ? "waiting" : "running";
                        out.put(String.valueOf(c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID))), new JSONObject()
                                .put("state", state)
                                .put("done", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                                .put("total", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                                .put("reason", c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))));
                    }
                }
            } catch (Exception ignored) { }
            return out.toString();
        }

        @JavascriptInterface
        public void cancelDownload(long dl) {
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).remove(dl);
        }
    }
}
