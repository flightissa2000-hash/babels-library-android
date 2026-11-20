package com.personal.babelslibrary;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.service.dreams.DreamService;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * The sleep screen as Android's screen saver (Settings → Display → Screen saver → Babel's Library): shown while the
 * phone charges (or sits in a dock). It's the same page the app shows when you leave it idle (assets/web/sleep.html),
 * drawn in your theme from what the app last told the widget (widget.json). Any touch wakes the phone.
 */
public class SleepDream extends DreamService {
    static final String HOST = "appassets.androidplatform.net";
    private WebView web;

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);       // a touch ends it
        setFullscreen(true);
        setScreenBright(false);      // (dimmed: it's a night screen)
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(false);
        s.setTextZoom(100);
        web.setBackgroundColor(0xFF000000);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!HOST.equals(u.getHost())) return blank();
                WebResourceResponse own = serve(SleepDream.this, u.getPath() == null ? "/" : u.getPath());
                return own != null ? own : asset(SleepDream.this, u.getPath());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
        });
        setContentView(web);
        web.loadUrl("https://" + HOST + "/web/sleep.html?dream=1");
    }

    @Override
    public void onDetachedFromWindow() {
        if (web != null) { web.destroy(); web = null; }
        super.onDetachedFromWindow();
    }

    private static WebResourceResponse blank() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
    }

    private static WebResourceResponse bytes(String mime, byte[] b) {
        WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("image") ? null : "utf-8", new ByteArrayInputStream(b));
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        r.setResponseHeaders(h);
        return r;
    }

    /** what the sleep page asks for (the app's screen and the screen saver answer the same):
     *  /sleepdata.json (widget.json: theme, what you're reading, the challenge), /battery.json, /wcover/<id> (a cover
     *  the app already has; never fetched here), /appicon?p=&c= (an app's icon) */
    static WebResourceResponse serve(Context c, String path) {
        try {
            if (path.equals("/sleepdata.json")) {
                File f = new File(c.getFilesDir(), "widget.json");
                return bytes("application/json", f.isFile() ? Launcher.read(f) : "{}".getBytes(StandardCharsets.UTF_8));
            }
            if (path.equals("/battery.json")) return bytes("application/json", Launcher.battery(c).toString().getBytes(StandardCharsets.UTF_8));
            if (path.startsWith("/wcover/")) {
                String id = path.substring(8).replaceAll("[^0-9]", "");
                File[] fs = new File(c.getCacheDir(), "covers").listFiles((x, n) -> n.startsWith(id + "_"));
                if (id.isEmpty() || fs == null || fs.length == 0) return blank();
                return bytes("image/jpeg", Launcher.read(fs[0]));
            }
        } catch (Exception e) { return blank(); }
        return null;
    }

    static WebResourceResponse appIcon(Context c, Uri u) {
        try {
            String p = u.getQueryParameter("p"), cl = u.getQueryParameter("c");
            if (p == null || cl == null) return blank();
            WebResourceResponse r = new WebResourceResponse("image/png", null, new ByteArrayInputStream(Launcher.read(Launcher.icon(c, p, cl))));
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "max-age=86400");
            r.setResponseHeaders(h);
            return r;
        } catch (Exception e) { return blank(); }
    }

    private static WebResourceResponse asset(Context c, String path) {
        String p = path == null ? "" : path.startsWith("/") ? path.substring(1) : path;
        if (p.contains("..") || p.isEmpty()) return blank();
        try {
            InputStream in = c.getAssets().open(p, AssetManager.ACCESS_STREAMING);
            String ext = p.substring(p.lastIndexOf('.') + 1).toLowerCase();
            String mime = ext.equals("html") ? "text/html" : ext.equals("css") ? "text/css" : ext.equals("js") ? "application/javascript"
                    : ext.equals("json") ? "application/json" : ext.equals("jpg") || ext.equals("jpeg") ? "image/jpeg" : ext.equals("png") ? "image/png"
                    : ext.equals("woff2") ? "font/woff2" : ext.equals("woff") ? "font/woff" : ext.equals("ttf") ? "font/ttf" : ext.equals("svg") ? "image/svg+xml" : "application/octet-stream";
            return new WebResourceResponse(mime, mime.startsWith("text") || mime.endsWith("json") || mime.endsWith("javascript") ? "utf-8" : null, in);
        } catch (Exception e) { return blank(); }
    }
}
