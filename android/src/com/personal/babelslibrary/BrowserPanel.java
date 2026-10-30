package com.personal.babelslibrary;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.GZIPInputStream;

/**
 * The phone's browser, inside the app's own screen (on the Browser tab, beside the app's tabs): one tab, its own bar (back, forward, reload, address or search, close), ads and trackers
 * blocked with the computer's block lists, pop-ups refused, and every page kept in history (browser_history.json,
 * shown on the app's Browser tab). Passwords are Android's job: its autofill service (Google Password Manager,
 * Samsung Pass...) offers and fills them in here like in any app.
 */
public class BrowserPanel extends android.content.ContextWrapper {
    private final Activity act;                          // the app's screen it lives in
    private final android.widget.FrameLayout screen;     // the whole screen (a full-screen video goes here)
    Runnable onClosed;                                   // ✕ on the last page: the app shows the Browser tab's start page

    /** The browser, opening a page (or the page you had, from saved): add view() to the screen. */
    BrowserPanel(Activity act, android.widget.FrameLayout screen, String url, Bundle saved) {
        super(act);
        this.act = act;
        this.screen = screen;
        build(url, saved);
        onResume();
    }
    View view() { return stage; }
    // (kept as plain text: the app asks from its own thread, and a WebView only answers on the UI thread)
    private volatile String curUrl = "", curTitle = "";
    String url() { return curUrl; }
    String title() { return curTitle; }
    /** a link or search from the app: opens here (the page you had is in Back) */
    void open(String url) { if (url != null && !url.isEmpty()) go(url); }
    /** the page and its Back history, to carry on in a new panel (a new layout or theme) */
    Bundle save() { Bundle b = new Bundle(); if (webA != null) webA.saveState(b); return b; }
    /** room for the camera hole when the browser reaches the top of the screen */
    void topInset(int px) { if (topLine != null) topLine.setPadding(dp(16), px + dp(6), dp(16), 0); }

    // (what the screen did for it when it was a screen of its own)
    private void runOnUiThread(Runnable r) { act.runOnUiThread(r); }
    private android.view.Window getWindow() { return act.getWindow(); }
    private void setRequestedOrientation(int o) { act.setRequestedOrientation(o); }
    private <T extends View> T findViewById(int id) { return act.findViewById(id); }
    private void requestPermissions(String[] p, int code) { act.requestPermissions(p, code); }
    private boolean closed = false;
    private boolean isFinishing() { return closed; }

    static final String EXTRA_URL = "url";
    private static final Object LOCK = new Object();
    private static volatile Set<String> blocked = null;   // ad and tracker sites (from the computer)
    private static volatile String hideJs = "";

    // split view (⧉): two pages, one above the other; "web" is the half the bar works on (the one touched last)
    private WebView web, webA, webB;
    private android.widget.FrameLayout boxA, boxB;
    private LinearLayout panes;
    private View divider;
    private final java.util.Map<WebView, String> going = new java.util.concurrent.ConcurrentHashMap<>(), current = new java.util.concurrent.ConcurrentHashMap<>();
    private int markOn = ACCENT, markOff = 0xFF35415F;
    private static volatile String ytJs = null;          // takes YouTube's own ads out (assets/web/yt_adblock.js, from the computer's adblock.py)
    private EditText address;
    private ProgressBar progress;
    private Button backBtn, fwdBtn, splitBtn;
    private boolean editing = false;

    static File historyFile(Context c) { return new File(c.getFilesDir(), "browser_history.json"); }
    static File blockFile(Context c) { return new File(c.getFilesDir(), "adblock.json.gz"); }

    /** Read the block lists the app fetched from the computer (once per run, in the background). */
    static void loadBlocklist(Context c) {
        synchronized (LOCK) {
            if (blocked != null) return;
            Set<String> set = new HashSet<>();
            File f = blockFile(c);
            if (f.isFile()) {
                try (GZIPInputStream in = new GZIPInputStream(new FileInputStream(f))) {
                    JSONObject o = new JSONObject(new String(Net.readAll(in), StandardCharsets.UTF_8));
                    JSONArray d = o.getJSONArray("domains");
                    for (int i = 0; i < d.length(); i++) set.add(d.getString(i));
                    hideJs = o.optString("hide", "");
                } catch (Exception ignored) { }
            }
            blocked = set;
        }
    }

    static void forgetBlocklist() { synchronized (LOCK) { blocked = null; } }

    static String readHistory(Context c) {
        synchronized (LOCK) {
            File f = historyFile(c);
            if (!f.isFile()) return "[]";
            try (FileInputStream in = new FileInputStream(f)) { return new String(Net.readAll(in), StandardCharsets.UTF_8); }
            catch (Exception e) { return "[]"; }
        }
    }

    static boolean writeHistory(Context c, String json) {
        synchronized (LOCK) {
            try {
                new JSONArray(json);                        // only ever a valid list
                File f = historyFile(c), tmp = new File(f.getPath() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(json.getBytes(StandardCharsets.UTF_8)); }
                return tmp.renameTo(f);
            } catch (Exception e) {
                return false;
            }
        }
    }

    private static String site(String host) {
        String[] p = host.split("\\.");
        int n = p.length > 2 && p[p.length - 1].length() == 2 && p[p.length - 2].matches("co|com|net|org|ac|or|ne|go") ? 3 : 2;
        StringBuilder b = new StringBuilder();
        for (int i = Math.max(0, p.length - n); i < p.length; i++) { if (b.length() > 0) b.append('.'); b.append(p[i]); }
        return b.toString();
    }

    private static boolean isBlocked(String host, String top) {
        Set<String> s = blocked;
        if (s == null || s.isEmpty() || host == null || host.isEmpty()) return false;
        if (!top.isEmpty() && site(host).equals(site(top))) return false;
        String[] p = host.toLowerCase().split("\\.");
        for (int i = 0; i < p.length - 1; i++) {
            StringBuilder b = new StringBuilder();
            for (int j = i; j < p.length; j++) { if (b.length() > 0) b.append('.'); b.append(p[j]); }
            if (s.contains(b.toString())) return true;
        }
        return false;
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private static final int NIGHT = 0xFF161C2C, NIGHT2 = 0xFF222B42, ACCENT = 0xFFFF6B4A;

    /** A round glyph button that ripples when pressed. */
    private Button barButton(String text, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(0xFFECF0FA);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, text.equals("W") ? 17 : 18);
        if (text.equals("W")) b.setTypeface(android.graphics.Typeface.SERIF, android.graphics.Typeface.BOLD);
        android.graphics.drawable.GradientDrawable round = new android.graphics.drawable.GradientDrawable();
        round.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        round.setColor(NIGHT2);
        b.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x55FFFFFF), round, null));
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        b.setPadding(0, 0, 0, 0);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(37), dp(37));
        lp.setMargins(dp(2), 0, dp(2), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private Button wikiBtn, reloadBtn, closeBtn, saveBtn, starBtn, keyBtn;
    private android.widget.TextView leaveBtn;      // ‹ Library: back to the app, the page stays open here
    private boolean wikiNext = false;   // W pressed with nothing typed: the next search goes to Wikipedia
    private android.widget.TextView clock, where;
    private LinearLayout rootView, barRow;
    private String searchHint = "⌕  Search or type an address";
    private int wikiInk = 0xFFECF0FA;

    private static int col(JSONObject o, String k, int def) {
        try {
            String v = o.optString(k, "").trim();
            if (v.isEmpty()) return def;
            if (v.length() == 4 && v.startsWith("#")) v = "#" + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2) + v.charAt(3) + v.charAt(3);
            return Color.parseColor(v);
        } catch (Exception e) {
            return def;
        }
    }

    private android.graphics.drawable.Drawable shape(int fill, int stroke, float strokeDp, float radiusDp, boolean oval) {
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        if (oval) g.setShape(android.graphics.drawable.GradientDrawable.OVAL); else g.setCornerRadius(dp((int) radiusDp));
        g.setColor(fill);
        if (strokeDp > 0) g.setStroke(Math.max(1, Math.round(strokeDp * getResources().getDisplayMetrics().density)), stroke);
        return new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x44000000), g, null);
    }

    /** A bar with a line under it (the theme's border). */
    private android.graphics.drawable.Drawable underlined(int fill, int line, int lineDp) {
        android.graphics.drawable.ColorDrawable under = new android.graphics.drawable.ColorDrawable(line), top = new android.graphics.drawable.ColorDrawable(fill);
        android.graphics.drawable.LayerDrawable ld = new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[]{under, top});
        ld.setLayerInset(1, 0, 0, 0, dp(lineDp));
        return ld;
    }

    /** The bar in the app's theme, like the computer's browser: Word Town's candy buttons, Gruvbox's terminal. */
    private void themeBar() {
        JSONObject t;
        try { t = new JSONObject(getSharedPreferences("browser", MODE_PRIVATE).getString("theme", "{}")); } catch (Exception e) { t = new JSONObject(); }
        String name = t.optString("theme", "");
        Button[] btns = {backBtn, saveBtn, wikiBtn, reloadBtn, closeBtn, splitBtn, starBtn, keyBtn};
        if ("wordtown".equals(name)) {
            int navy = col(t, "line", 0xFF22304A), sky = col(t, "bg", 0xFFBFE7FF), white = col(t, "surface", Color.WHITE), accent = col(t, "accent", ACCENT);
            markOn = accent; markOff = navy;
            rootView.setBackgroundColor(sky);
            topLine.setBackgroundColor(sky);
            clock.setTextColor(navy);
            where.setTextColor(col(t, "soft", 0xFF5B6B86));
            barRow.setBackground(underlined(white, navy, 3));
            int[] fills = {0xFFFFC93C, 0xFF8FD17A, 0xFFFFF3D6, 0xFF4AA8FF, accent, 0xFFFF8FC0, 0xFFFFF3D6, 0xFFFFC93C};
            for (int i = 0; i < btns.length; i++) {
                btns[i].setBackground(shape(fills[i], navy, 2.5f, 0, true));
                btns[i].setTextColor(i == 3 || i == 4 ? Color.WHITE : navy);
            }
            wikiInk = navy;
            address.setBackground(shape(Color.WHITE, navy, 3f, 22, false));
            address.setTextColor(navy);
            address.setHintTextColor(0xFF7A869E);
            address.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            progress.setProgressTintList(android.content.res.ColorStateList.valueOf(accent));
            progress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(sky));
        } else if ("gruvbox".equals(name)) {
            int dark = 0xFF1D2021, bg = 0xFF282828, cream = col(t, "ink", 0xFFEBDBB2), line = 0xFF504945;
            markOn = 0xFFFABD2F; markOff = line;
            rootView.setBackgroundColor(dark);
            topLine.setBackgroundColor(dark);
            clock.setTextColor(0xFFFABD2F);
            clock.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
            where.setTextColor(0xFF83A598);
            where.setTypeface(android.graphics.Typeface.MONOSPACE);
            barRow.setBackground(underlined(dark, line, 1));
            for (Button b : btns) {
                b.setBackground(shape(bg, 0xFF3C3836, 1f, 3, false));
                b.setTextColor(0xFFA89984);
                LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) b.getLayoutParams();
                lp.width = dp(36); lp.height = dp(36); lp.setMargins(dp(2), 0, dp(2), 0);
            }
            wikiBtn.setTextColor(wikiInk = 0xFF83A598);
            closeBtn.setTextColor(0xFFFB4934);
            address.setBackground(shape(bg, line, 1f, 3, false));
            address.setTextColor(cream);
            address.setHintTextColor(0xFF7C6F64);
            address.setTypeface(android.graphics.Typeface.MONOSPACE);
            searchHint = "$ search or type an address";
            address.setHint(searchHint);
            progress.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFFABD2F));
            progress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(dark));
        }
        layoutName = t.optString("layout", "standard");
        swapMode = "swap".equals(t.optString("second", "split"));
        if (splitBtn != null && webB == null) splitBtn.setText(swapMode ? "⇄" : "⧉");
        paintLeave();
    }

    private void build(String startUrl, Bundle saved) {
        new Thread(() -> loadBlocklist(this)).start();
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(NIGHT);
        // a slim line with the clock and the site (the phone's own status bar is hidden), then the bar itself
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(16), dp(6), dp(16), 0);
        clock = new android.widget.TextView(this);
        clock.setTextColor(0xFFECF0FA);
        clock.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        clock.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        where = new android.widget.TextView(this);
        where.setTextColor(0xFF8F9BB5);
        where.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        where.setSingleLine(true);
        where.setEllipsize(android.text.TextUtils.TruncateAt.END);
        where.setGravity(Gravity.END);
        leaveBtn = new android.widget.TextView(this);
        leaveBtn.setText("‹ Library");
        leaveBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        leaveBtn.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        leaveBtn.setPadding(dp(10), dp(4), dp(12), dp(4));
        leaveBtn.setContentDescription("Back to the library (the page stays open)");
        leaveBtn.setOnClickListener(v -> { });
        LinearLayout.LayoutParams lbp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lbp.setMargins(0, 0, dp(10), 0);
        top.addView(leaveBtn, lbp);
        leaveBtn.setVisibility(View.GONE);             // (the app's own tabs are beside the browser now)
        top.addView(clock);
        top.addView(where, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(6), dp(6), dp(6), dp(8));
        backBtn = barButton("◀", v -> { if (web.canGoBack()) web.goBack(); });
        fwdBtn = barButton("▶", v -> { if (web.canGoForward()) web.goForward(); });
        Button reload = reloadBtn = barButton("⟳", v -> web.reload());
        Button close = closeBtn = barButton("✕", v -> closeTab());
        wikiBtn = barButton("W", v -> wiki());
        saveBtn = barButton("⤓", v -> savePage());
        splitBtn = barButton(swapMode ? "⇄" : "⧉", v -> split());
        starBtn = barButton("☆", v -> star());
        keyBtn = barButton("🔑", v -> fillPassword());
        keyBtn.setVisibility(View.GONE);
        address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        address.setTextColor(0xFFECF0FA);
        address.setHintTextColor(0xFF7F8BA6);
        address.setHint("⌕  Search or type an address");
        android.graphics.drawable.GradientDrawable pill = new android.graphics.drawable.GradientDrawable();
        pill.setCornerRadius(dp(22));
        pill.setColor(NIGHT2);
        pill.setStroke(dp(1), 0xFF35415F);
        address.setBackground(pill);
        address.setPadding(dp(14), dp(8), dp(14), dp(8));
        address.setSelectAllOnFocus(true);
        // typing: the box takes the room of the buttons you don't need then (in the bar layouts), and shows the whole
        // address; otherwise it shows it short (no https://), as the room beside the app's tabs is narrow
        address.setOnFocusChangeListener((v, has) -> {
            editing = has;
            if ("standard".equals(layoutName) || "bottom".equals(layoutName))
                for (Button b : new Button[]{starBtn, splitBtn, saveBtn, reloadBtn}) b.setVisibility(has ? View.GONE : View.VISIBLE);
            if (has) { String u = web.getUrl() == null ? "" : web.getUrl(); if (u.startsWith("http")) { address.setText(u); address.selectAll(); } }
            else refreshBar();
        });
        address.setOnEditorActionListener((v, id, ev) -> {
            if (id == EditorInfo.IME_ACTION_GO || (ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                if (ev == null || ev.getAction() == KeyEvent.ACTION_DOWN) go(address.getText().toString());   // once, not on key-up too
                return true;
            }
            return false;
        });
        bar.addView(backBtn);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(0, dp(42), 1);
        ap.setMargins(dp(4), 0, dp(4), 0);
        bar.addView(address, ap);
        bar.addView(wikiBtn);
        bar.addView(splitBtn);
        bar.addView(saveBtn);
        bar.addView(reload);
        bar.addView(close);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        progress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(NIGHT));
        root.addView(top, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(progress, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(3)));
        topLine = top;
        rootView = root;
        barRow = bar;
        themeBar();
        tick.run();

        panes = new LinearLayout(this);
        panes.setOrientation(LinearLayout.VERTICAL);
        webA = web = makeWeb();
        boxA = box(webA);
        panes.addView(boxA, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(panes, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        stage = new android.widget.FrameLayout(this);
        stage.addView(root, new android.widget.FrameLayout.LayoutParams(-1, -1));
        arrange(layoutName);
        new Thread(() -> {
            if (ytJs != null) return;
            try (java.io.InputStream in = getAssets().open("web/yt_adblock.js")) { ytJs = new String(Net.readAll(in), StandardCharsets.UTF_8); }
            catch (Exception e) { ytJs = ""; }
        }).start();
        paintLeave();
        // carrying on (a new layout or theme): the same page with its Back history; else the page asked for, or the
        // page that was open when the app was last closed
        if (saved != null && webA.restoreState(saved) != null) { refreshBar(); return; }
        String start = startUrl;
        if (start == null || start.isEmpty()) start = getSharedPreferences("browser", MODE_PRIVATE).getString("open_url", "");
        go(start == null ? "" : start);
    }

    /** ‹ Library in the top line, in the colours of the clock beside it */
    private void paintLeave() {
        if (leaveBtn == null) return;
        int ink = clock.getCurrentTextColor();
        leaveBtn.setTextColor(ink);
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setCornerRadius(dp(14));
        g.setColor((ink & 0x00FFFFFF) | 0x22000000);
        g.setStroke(dp(1), (ink & 0x00FFFFFF) | 0x66000000);
        leaveBtn.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x44000000), g, null));
    }


    /* ---------------- layouts (🧭 on the Browser tab): where the controls live ----------------
       standard: the bar on top · bottom: the bar at the bottom, by your thumb · rail: the address on top, the buttons
       down the right · orb: no bar, a glowing orb that fans the buttons out around itself · tv: the page on the screen
       of a wood-cabinet telly, with knobs and a green channel display underneath */
    private String layoutName = "standard";
    private android.widget.FrameLayout stage;            // everything, plus what floats over it (the orb, a full-screen video)
    private Button orbBtn;
    private boolean fanOpen = false;
    private final java.util.List<Button> fanBtns = new java.util.ArrayList<>();

    private static void detach(View v) { if (v != null && v.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) v.getParent()).removeView(v); }
    private LinearLayout.LayoutParams lp(int w, int h, float weight) { return new LinearLayout.LayoutParams(w, h, weight); }

    private void arrange(String layout) {
        final int MATCH = LinearLayout.LayoutParams.MATCH_PARENT, WRAP = LinearLayout.LayoutParams.WRAP_CONTENT;
        Button[] btns = {backBtn, wikiBtn, splitBtn, saveBtn, reloadBtn, closeBtn, starBtn, keyBtn};
        for (Button b : btns) detach(b);
        detach(address); detach(topLine); detach(barRow); detach(progress); detach(panes);
        rootView.removeAllViews();
        LinearLayout.LayoutParams addrLp = lp(0, dp(42), 1);
        addrLp.setMargins(dp(4), 0, dp(4), 0);
        switch (layout) {
            case "bottom": {
                for (Button b : new Button[]{backBtn}) barRow.addView(b);
                barRow.addView(address, addrLp);
                for (Button b : new Button[]{keyBtn, starBtn, wikiBtn, splitBtn, saveBtn, reloadBtn, closeBtn}) barRow.addView(b);
                barRow.setPadding(dp(6), dp(8), dp(6), dp(26));          // (clear of Android's swipe-up strip)
                rootView.addView(topLine, lp(MATCH, WRAP, 0));
                rootView.addView(panes, lp(MATCH, 0, 1));
                rootView.addView(progress, lp(MATCH, dp(3), 0));
                rootView.addView(barRow, lp(MATCH, WRAP, 0));
                break;
            }
            case "rail": {
                barRow.addView(address, addrLp);
                barRow.addView(wikiBtn);
                LinearLayout row = new LinearLayout(this);
                LinearLayout rail = new LinearLayout(this);
                rail.setOrientation(LinearLayout.VERTICAL);
                rail.setGravity(Gravity.CENTER_HORIZONTAL);
                rail.setPadding(dp(4), dp(10), dp(4), dp(10));
                rail.setBackground(barRow.getBackground() == null ? null : barRow.getBackground().getConstantState().newDrawable());
                for (Button b : new Button[]{backBtn, reloadBtn, starBtn, keyBtn, splitBtn, saveBtn}) { rail.addView(b); ((LinearLayout.LayoutParams) b.getLayoutParams()).setMargins(0, dp(6), 0, dp(6)); }
                View gap = new View(this);
                rail.addView(gap, lp(1, 0, 1));
                rail.addView(closeBtn);
                row.addView(panes, lp(0, MATCH, 1));
                row.addView(rail, lp(dp(54), MATCH, 0));
                rootView.addView(topLine, lp(MATCH, WRAP, 0));
                rootView.addView(barRow, lp(MATCH, WRAP, 0));
                rootView.addView(progress, lp(MATCH, dp(3), 0));
                rootView.addView(row, lp(MATCH, 0, 1));
                break;
            }
            case "orb": {
                rootView.addView(topLine, lp(MATCH, WRAP, 0));
                rootView.addView(progress, lp(MATCH, dp(3), 0));
                rootView.addView(panes, lp(MATCH, 0, 1));
                buildOrb(btns);
                break;
            }
            case "tv": {
                // the set in each theme: Word Town's cartoon telly (sky, navy outlines, candy knobs), Gruvbox's warm dark set
                String th = themeName();
                boolean wt = "wordtown".equals(th), gb = "gruvbox".equals(th);
                int[] cab = wt ? new int[]{0xFFBFE7FF, 0xFF8FD17A} : gb ? new int[]{0xFF3C3836, 0xFF32302F} : new int[]{0xFFA26F42, 0xFF5C3A20};
                int bezelC = wt ? 0xFF22304A : gb ? 0xFF1D2021 : 0xFF111111, bezelEdge = wt ? 0xFFFF6B4A : 0xFF000000;
                int plateA = wt ? 0xFFFFC93C : gb ? 0xFF282828 : 0xFF2D2D2D, plateB = wt ? 0xFFFFC93C : gb ? 0xFF1D2021 : 0xFF191919;
                int brass = wt ? 0xFF22304A : gb ? 0xFFD79921 : 0xFFB8964F, ink = wt ? 0xFF22304A : gb ? 0xFFFABD2F : 0xFFD8B866;
                int lcd = wt ? 0xFF22304A : gb ? 0xFF1D2021 : 0xFF06170D, lcdInk = wt ? 0xFF8FD17A : gb ? 0xFFB8BB26 : 0xFF6BFF9E;
                rootView.setBackground(new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR, cab));
                topLine.setBackgroundColor(0x00000000);
                clock.setTextColor(wt ? 0xFF22304A : 0xFFF3E7C4);
                paintLeave();
                where.setTextColor(ink);
                android.widget.FrameLayout screen = new android.widget.FrameLayout(this);
                android.graphics.drawable.GradientDrawable bezel = new android.graphics.drawable.GradientDrawable();
                bezel.setColor(bezelC);
                bezel.setCornerRadius(dp(30));
                bezel.setStroke(dp(wt ? 5 : 4), bezelEdge);
                screen.setBackground(bezel);
                screen.setPadding(dp(14), dp(14), dp(14), dp(14));
                screen.addView(panes, new android.widget.FrameLayout.LayoutParams(-1, -1));
                panes.setClipToOutline(true);
                LinearLayout panel = new LinearLayout(this);
                panel.setOrientation(LinearLayout.VERTICAL);
                panel.setPadding(dp(12), dp(10), dp(12), dp(26));
                android.graphics.drawable.GradientDrawable plate = new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM, new int[]{plateA, plateB});
                plate.setCornerRadius(dp(18));
                if (wt) plate.setStroke(dp(4), 0xFF22304A);
                panel.setBackground(plate);
                android.widget.TextView brand = new android.widget.TextView(this);
                brand.setText("B A B E L - V I S I O N");
                brand.setTextColor(ink);
                brand.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
                brand.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
                brand.setGravity(Gravity.CENTER);
                panel.addView(brand, lp(MATCH, WRAP, 0));
                LinearLayout chan = new LinearLayout(this);
                chan.setGravity(Gravity.CENTER_VERTICAL);
                chan.setPadding(0, dp(8), 0, dp(10));
                address.setBackground(shape(lcd, wt ? 0xFF22304A : 0xFF000000, 2f, 6, false));
                address.setTextColor(lcdInk);
                address.setHintTextColor((lcdInk & 0x00FFFFFF) | 0x88000000);
                address.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
                address.setShadowLayer(wt ? 0f : 8f, 0, 0, lcdInk);
                searchHint = "TUNE IN: search or address";
                address.setHint(searchHint);
                chan.addView(address, addrLp);
                chan.addView(wikiBtn);
                panel.addView(chan, lp(MATCH, WRAP, 0));
                // the knobs in one even row, each with its label underneath; Close tab as a wide button below
                LinearLayout knobs = new LinearLayout(this);
                knobs.setGravity(Gravity.CENTER_HORIZONTAL);
                String[][] names = {{"BACK"}, {"RELOAD"}, {"BOOKMARK"}, {"PASSWORD"}, {"SPLIT"}, {"SAVE"}};
                Button[] row = {backBtn, reloadBtn, starBtn, keyBtn, splitBtn, saveBtn};
                for (int i = 0; i < row.length; i++) {
                    Button b = row[i];
                    LinearLayout cell = new LinearLayout(this);
                    cell.setOrientation(LinearLayout.VERTICAL);
                    cell.setGravity(Gravity.CENTER_HORIZONTAL);
                    b.setBackground(wt ? shape(0xFFFFFFFF, 0xFF22304A, 3f, 0, true) : knob(brass));
                    b.setTextColor(ink);
                    b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
                    cell.addView(b, lp(dp(42), dp(42), 0));
                    android.widget.TextView label = new android.widget.TextView(this);
                    label.setText(names[i][0]);
                    label.setTextColor(ink);
                    label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 8);
                    label.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
                    label.setPadding(0, dp(3), 0, 0);
                    cell.addView(label, lp(WRAP, WRAP, 0));
                    if (b == keyBtn) b.setVisibility(View.VISIBLE);       // (the slot keeps its place; it's greyed out where there's no password)
                    knobs.addView(cell, lp(0, WRAP, 1));
                }
                panel.addView(knobs, lp(MATCH, WRAP, 0));
                closeBtn.setText("✕  CLOSE TAB");
                closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                closeBtn.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
                closeBtn.setBackground(shape(wt ? 0xFFFF6B4A : gb ? 0xFF3C3836 : 0xFF2A1414, wt ? 0xFF22304A : 0xFFC0392B, wt ? 3f : 2f, 22, false));
                closeBtn.setTextColor(wt ? 0xFFFFFFFF : 0xFFFF7B6B);
                LinearLayout.LayoutParams cp = lp(MATCH, dp(42), 0);
                cp.setMargins(dp(4), dp(12), dp(4), 0);
                LinearLayout knobs2 = new LinearLayout(this);
                knobs2.addView(closeBtn, cp);
                wikiBtn.setBackground(wt ? shape(0xFFFFFFFF, 0xFF22304A, 3f, 0, true) : knob(brass));
                wikiBtn.setTextColor(ink);
                panel.addView(knobs2, lp(MATCH, WRAP, 0));
                LinearLayout.LayoutParams sp = lp(MATCH, 0, 1);
                sp.setMargins(dp(10), dp(4), dp(10), dp(12));
                rootView.setPadding(0, 0, 0, 0);
                rootView.addView(topLine, lp(MATCH, WRAP, 0));
                rootView.addView(progress, lp(MATCH, dp(3), 0));
                rootView.addView(screen, sp);
                LinearLayout.LayoutParams pp = lp(MATCH, WRAP, 0);
                pp.setMargins(dp(10), 0, dp(10), dp(10));
                rootView.addView(panel, pp);
                break;
            }
            default: {        // standard: the bar on top
                barRow.addView(backBtn);
                barRow.addView(address, addrLp);
                for (Button b : new Button[]{keyBtn, starBtn, wikiBtn, splitBtn, saveBtn, reloadBtn, closeBtn}) barRow.addView(b);
                rootView.addView(topLine, lp(MATCH, WRAP, 0));
                rootView.addView(barRow, lp(MATCH, WRAP, 0));
                rootView.addView(progress, lp(MATCH, dp(3), 0));
                rootView.addView(panes, lp(MATCH, 0, 1));
            }
        }
    }

    private String themeName() {
        try { return new JSONObject(getSharedPreferences("browser", MODE_PRIVATE).getString("theme", "{}")).optString("theme", ""); } catch (Exception e) { return ""; }
    }

    /** a TV knob: dark and domed, with a brass (or red) ring */
    private android.graphics.drawable.Drawable knob(int ring) {
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        g.setGradientType(android.graphics.drawable.GradientDrawable.RADIAL_GRADIENT);
        g.setGradientRadius(dp(30));
        g.setGradientCenter(0.35f, 0.3f);
        g.setColors(new int[]{0xFF5C5C5C, 0xFF141414});
        g.setStroke(dp(3), ring);
        return new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x55FFFFFF), g, null);
    }

    /** the Orb: a glowing button in the corner; tapped, the controls fan out around it and the address bubble appears */
    private android.widget.FrameLayout addrBubble;
    private void buildOrb(Button[] btns) {
        orbBtn = new Button(this);
        orbBtn.setText("◉");
        orbBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        orbBtn.setTextColor(0xFFFFFFFF);
        android.graphics.drawable.GradientDrawable orb = new android.graphics.drawable.GradientDrawable();
        orb.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        orb.setGradientType(android.graphics.drawable.GradientDrawable.RADIAL_GRADIENT);
        orb.setGradientRadius(dp(40));
        orb.setGradientCenter(0.35f, 0.3f);
        orb.setColors(new int[]{0xFFFFFFFF, markOn, darker(markOn)});
        orbBtn.setBackground(orb);
        orbBtn.setElevation(dp(10));
        orbBtn.setPadding(0, 0, 0, 0);
        orbBtn.setOnClickListener(v -> fan(!fanOpen));
        android.widget.FrameLayout.LayoutParams op = new android.widget.FrameLayout.LayoutParams(dp(68), dp(68), Gravity.BOTTOM | Gravity.END);
        op.setMargins(0, 0, dp(22), dp(48));
        fanBtns.clear();
        for (Button b : new Button[]{backBtn, reloadBtn, starBtn, keyBtn, splitBtn, saveBtn, wikiBtn, closeBtn}) {
            android.widget.FrameLayout.LayoutParams bp = new android.widget.FrameLayout.LayoutParams(dp(46), dp(46), Gravity.BOTTOM | Gravity.END);
            bp.setMargins(0, 0, dp(22 + 11), dp(48 + 11));
            b.setElevation(dp(8));
            b.setVisibility(View.INVISIBLE);
            stage.addView(b, bp);
            fanBtns.add(b);
        }
        addrBubble = new android.widget.FrameLayout(this);
        android.widget.FrameLayout.LayoutParams ab = new android.widget.FrameLayout.LayoutParams(-1, dp(46), Gravity.BOTTOM);
        ab.setMargins(dp(14), 0, dp(100), dp(59));
        addrBubble.addView(address, new android.widget.FrameLayout.LayoutParams(-1, -1));
        addrBubble.setElevation(dp(8));
        addrBubble.setVisibility(View.INVISIBLE);
        stage.addView(addrBubble, ab);
        stage.addView(orbBtn, op);
        // a slow glow, so it's easy to find
        android.animation.ObjectAnimator glow = android.animation.ObjectAnimator.ofFloat(orbBtn, "alpha", 1f, .75f);
        glow.setDuration(1300); glow.setRepeatCount(android.animation.ValueAnimator.INFINITE); glow.setRepeatMode(android.animation.ValueAnimator.REVERSE);
        glow.start();
    }
    private static int darker(int c) { return 0xFF000000 | (((c >> 16 & 0xFF) * 6 / 10) << 16) | (((c >> 8 & 0xFF) * 6 / 10) << 8) | ((c & 0xFF) * 6 / 10); }
    private void fan(boolean open) {
        if (orbBtn == null) return;
        fanOpen = open;
        orbBtn.animate().rotation(open ? 135f : 0f).setDuration(260).start();
        int n = fanBtns.size();
        for (int i = 0; i < n; i++) {
            Button b = fanBtns.get(i);
            if (b == keyBtn && !hasLogins) { b.setVisibility(View.INVISIBLE); continue; }     // (only on a site you have a password for)
            double a = Math.toRadians(180 + 90.0 * i / (n - 1));      // a quarter circle, up and to the left of the orb
            float r = dp(i % 2 == 0 ? 118 : 158);
            if (open) {
                b.setVisibility(View.VISIBLE);
                b.setScaleX(.2f); b.setScaleY(.2f); b.setAlpha(0f);
                b.animate().translationX((float) (Math.cos(a) * r)).translationY((float) (Math.sin(a) * r) - dp(36)).scaleX(1f).scaleY(1f).alpha(1f)
                        .setStartDelay(i * 30L).setDuration(300).setInterpolator(new android.view.animation.OvershootInterpolator(1.4f)).start();
            } else {
                b.animate().translationX(0).translationY(0).scaleX(.2f).scaleY(.2f).alpha(0f).setStartDelay(0).setDuration(200)
                        .withEndAction(() -> { if (!fanOpen) b.setVisibility(View.INVISIBLE); }).start();
            }
        }
        if (open) {
            addrBubble.setVisibility(View.VISIBLE);
            addrBubble.setAlpha(0f); addrBubble.setTranslationX(dp(30));
            addrBubble.animate().alpha(1f).translationX(0).setDuration(240).start();
        } else {
            addrBubble.animate().alpha(0f).translationX(dp(30)).setDuration(180).withEndAction(() -> { if (!fanOpen) addrBubble.setVisibility(View.INVISIBLE); }).start();
            address.clearFocus();
        }
    }

    /* ---------------- full-screen video: the page hands over its video view; it fills the screen, sideways if the phone turns */
    private View fullView;
    private WebChromeClient.CustomViewCallback fullDone;
    private void showFull(View v, WebChromeClient.CustomViewCallback cb) {
        if (fullView != null) { cb.onCustomViewHidden(); return; }
        fullView = v;
        fullDone = cb;
        v.setBackgroundColor(0xFF000000);
        screen.addView(v, new android.widget.FrameLayout.LayoutParams(-1, -1));       // (the whole screen, over the app too)
        rootView.setVisibility(View.INVISIBLE);
        if (orbBtn != null) orbBtn.setVisibility(View.INVISIBLE);
        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);   // (sideways, either way round, like a video app)
        MainActivity.fullScreen(act);
        bars(false);
    }
    private void hideFull() {
        if (fullView == null) return;
        screen.removeView(fullView);
        fullView = null;
        rootView.setVisibility(View.VISIBLE);
        if (orbBtn != null) orbBtn.setVisibility(View.VISIBLE);
        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        bars(true);
        WebChromeClient.CustomViewCallback cb = fullDone;
        fullDone = null;
        if (cb != null) cb.onCustomViewHidden();
    }

    /** Full-screen video hides Android's own navigation bar (the gesture strip) too, like Firefox does: a swipe from the
     *  edge brings it back for a moment. Leaving full screen puts it back. */
    private void bars(boolean show) {
        View content = findViewById(android.R.id.content);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (show) c.show(android.view.WindowInsets.Type.navigationBars());
            else {
                c.hide(android.view.WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(show ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    : View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
        if (content != null) { if (!show) content.setPadding(0, 0, 0, 0); content.requestApplyInsets(); }
    }

    /** A page's frame: a thin line on top shows which half of a split view the bar works on. */
    private android.widget.FrameLayout box(WebView w) {
        android.widget.FrameLayout f = new android.widget.FrameLayout(this);
        f.addView(w, new android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.MATCH_PARENT));
        return f;
    }

    /* Pages are told they're still on screen when the phone is locked or you've switched apps, so a video (YouTube's
       above all) doesn't pause itself; PlaybackService keeps the phone from stopping it. */
    private static final String AWAKE_JS = "(()=>{if(window.__babelAwake)return;window.__babelAwake=1;try{"
            + "Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});"
            + "Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});"
            + "Object.defineProperty(document,'webkitVisibilityState',{get:()=>'visible',configurable:true});"
            + "Object.defineProperty(document,'webkitHidden',{get:()=>false,configurable:true});}catch(e){}"
            + "const stop=e=>e.stopImmediatePropagation();for(const t of ['visibilitychange','webkitvisibilitychange'])document.addEventListener(t,stop,true);"
            + "for(const t of ['pagehide','blur','freeze'])window.addEventListener(t,stop,true);})()";
    private static final String PLAYING_JS = "[...document.querySelectorAll('video,audio')].some(m=>!m.paused&&!m.ended&&m.readyState>2)";
    private static java.lang.ref.WeakReference<BrowserPanel> live = new java.lang.ref.WeakReference<>(null);
    static BrowserPanel current() { return live.get(); }

    /** The playing notification's buttons: play/pause, 10 seconds back or on, or stop (pause, and the notification goes). */
    void mediaCommand(String cmd) {
        final String code;
        switch (cmd == null ? "" : cmd) {
            case "pause": case "stop": code = "document.querySelectorAll('video,audio').forEach(m=>m.pause())"; break;
            case "play": case "toggle":
                code = "(()=>{const a=[...document.querySelectorAll('video,audio')];const p=a.filter(m=>!m.paused);if(p.length&&'" + cmd + "'==='toggle'){p.forEach(m=>m.pause());return}"
                        + "const m=a.find(m=>m.currentTime>0&&!m.ended)||a[0];if(m)m.play()})()"; break;
            case "fwd": case "next": case "back": case "prev":
                code = "(()=>{const a=[...document.querySelectorAll('video,audio')];const m=a.find(m=>!m.paused)||a.find(m=>m.currentTime>0)||a[0];if(m)m.currentTime=Math.max(0,m.currentTime"
                        + (cmd.equals("fwd") || cmd.equals("next") ? "+" : "-") + "10)})()"; break;
            default: return;
        }
        runOnUiThread(() -> {
            for (WebView w : new WebView[]{webA, webB}) if (w != null) w.evaluateJavascript(code, null);
            if ("stop".equals(cmd)) { keeping = false; wasPlaying = false; }
            ui.postDelayed(watchMedia, 400);         // (the notification shows the change straight away)
        });
    }

    /* While something plays, the playing service runs (Android only lets it start while the browser is on screen, so
       it starts with the video rather than when you leave); when nothing plays any more, it ends. */
    private boolean resumed = false, keeping = false, wasPlaying = false;
    private final Runnable watchMedia = new Runnable() {
        @Override public void run() {
            final boolean[] any = {false};
            final int[] left = {0};
            for (WebView w : new WebView[]{webA, webB}) if (w != null) left[0]++;
            for (WebView w : new WebView[]{webA, webB}) {
                if (w == null) continue;
                w.evaluateJavascript(PLAYING_JS, v -> {
                    if ("true".equals(v)) any[0] = true;
                    if (--left[0] > 0) return;
                    // the screen stays on while something plays (like a video app; the power button still turns it off)
                    if (any[0]) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    // playing, or paused after playing: the media notification (play/pause, ±10 s, ✕), like a browser's
                    if (any[0] && keeping && !wasPlaying) { PlaybackService.browser(BrowserPanel.this, w.getTitle(), true); wasPlaying = true; }
                    if (any[0] && !keeping && resumed) {
                        try { PlaybackService.browser(BrowserPanel.this, w.getTitle(), true); keeping = true; wasPlaying = true; } catch (Exception ignored) { }
                        // (its notification, with Stop, needs permission to show on Android 13+: asked once)
                        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
                                && !getSharedPreferences("browser", MODE_PRIVATE).getBoolean("askedNotify", false)) {
                            getSharedPreferences("browser", MODE_PRIVATE).edit().putBoolean("askedNotify", true).apply();
                            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 11);
                        }
                    } else if (!any[0] && keeping && wasPlaying) {
                        PlaybackService.browser(BrowserPanel.this, w.getTitle(), false);
                        wasPlaying = false;
                    }
                });
            }
            ui.postDelayed(this, 2500);
        }
    };

    void onPause() { resumed = false; }

    private static boolean isYouTube(String host) { return host != null && host.matches("(?i)(.*\\.)?youtube(-nocookie)?\\.com"); }

    private void ytAds(WebView v, String url) {
        v.evaluateJavascript(AWAKE_JS, null);           // (every page: a video keeps playing when the phone is locked)
        String js = ytJs;
        if (js != null && !js.isEmpty() && isYouTube(Uri.parse(url).getHost())) v.evaluateJavascript(js, null);
    }

    /** The bar shows the half you're using. */
    private void setActive(WebView w) {
        if (w == null) return;
        web = w;
        boolean two = webB != null && !swapMode;      // (a split view marks the half the bar works on; a swap shows one)
        int pad = two ? dp(3) : 0;
        boxA.setPadding(0, pad, 0, 0);
        boxA.setBackgroundColor(two && w == webA ? markOn : markOff);
        if (two) { boxB.setPadding(0, pad, 0, 0); boxB.setBackgroundColor(w == webB ? markOn : markOff); }
        refreshBar();
    }

    private void refreshBar() {
        String url = web.getUrl() == null ? "" : web.getUrl();
        if (!editing) address.setText(url.startsWith("http") ? url.replaceFirst("^https?://(www\\.)?", "") : "");
        backBtn.setEnabled(web.canGoBack());
        backBtn.setAlpha(web.canGoBack() ? 1f : 0.4f);
        fwdBtn.setEnabled(web.canGoForward());
        String h = url.startsWith("http") ? current.get(web) : null;
        where.setText(h == null ? "" : h.replaceFirst("^www\\.", ""));
        if (web == webA) { curUrl = url; curTitle = web.getTitle() == null ? "" : web.getTitle(); }
        if (url.startsWith("http") && webB == null)       // (remembered: the page comes back if Android closes the browser while you're away)
            getSharedPreferences("browser", MODE_PRIVATE).edit().putString("open_url", url).putString("open_title", web.getTitle() == null ? "" : web.getTitle()).apply();
        progress.setProgress(web.getProgress());
        progress.setVisibility(web.getProgress() >= 100 ? View.INVISIBLE : View.VISIBLE);
        // ☆/★: is this page bookmarked? 🔑: only shows on a site you have a saved password for
        boolean on = url.startsWith("http") && bookmarked(url);
        starBtn.setText(on ? "★" : "☆");
        starBtn.setTextColor(on ? 0xFFF2B705 : wikiInk);
        hasLogins = url.startsWith("http") && !Passwords.forSite(this, url).isEmpty();
        if ("tv".equals(layoutName)) { keyBtn.setEnabled(hasLogins); keyBtn.setAlpha(hasLogins ? 1f : .3f); }     // (the TV keeps every knob in its place)
        else if (orbBtn == null) keyBtn.setVisibility(hasLogins ? View.VISIBLE : View.GONE);
    }
    private boolean hasLogins = false;

    /** ✕: close the page you're on. In split view just that half (the other one stays); otherwise back to the
     *  browser's start page (the app's Browser tab), not wherever the browser was opened from. */
    private void closeTab() {
        if (webB != null) { setActive(web == webA ? webB : webA); unsplit(); return; }
        getSharedPreferences("browser", MODE_PRIVATE).edit().remove("open_url").remove("open_title").apply();
        if (onClosed != null) onClosed.run();
    }

    /* ---------------- bookmarks: shared with the computer (its list is the real one; a copy is kept here for offline) */
    static File bookmarkFile(Context c) { return new File(c.getFilesDir(), "bookmarks.json"); }
    static String readBookmarks(Context c) {
        synchronized (LOCK) {
            File f = bookmarkFile(c);
            if (!f.isFile()) return "[]";
            try (FileInputStream in = new FileInputStream(f)) { return new String(Net.readAll(in), StandardCharsets.UTF_8); } catch (Exception e) { return "[]"; }
        }
    }
    static void writeBookmarks(Context c, String json) {
        synchronized (LOCK) {
            try {
                new JSONArray(json);
                File f = bookmarkFile(c), tmp = new File(f.getPath() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(json.getBytes(StandardCharsets.UTF_8)); }
                tmp.renameTo(f);
            } catch (Exception ignored) { }
        }
    }
    private boolean bookmarked(String url) {
        try { JSONArray a = new JSONArray(readBookmarks(this)); for (int i = 0; i < a.length(); i++) if (url.equals(a.getJSONObject(i).optString("url"))) return true; } catch (Exception ignored) { }
        return false;
    }
    /** ☆: bookmark this page (or unbookmark it): here at once, and on the computer when it can be reached */
    private void star() {
        String url = web.getUrl(), title = web.getTitle();
        if (url == null || !url.startsWith("http")) { toast("Open a page first"); return; }
        boolean on = !bookmarked(url);
        try {
            JSONArray a = new JSONArray(readBookmarks(this)), out = new JSONArray();
            for (int i = 0; i < a.length(); i++) if (!url.equals(a.getJSONObject(i).optString("url"))) out.put(a.get(i));
            if (on) out.put(new JSONObject().put("url", url).put("title", title == null ? url : title).put("site", Passwords.siteOf(url)).put("pending", true));
            writeBookmarks(this, out.toString());
        } catch (Exception ignored) { }
        refreshBar();
        toast(on ? "Bookmarked: it's on your start page" : "Bookmark removed");
        new Thread(() -> {
            String body;
            try { body = new JSONObject().put("url", url).put("title", title == null ? "" : title).put("remove", !on).toString(); } catch (Exception e) { return; }
            for (String b : new String[]{Net.current, Net.lan, Net.remote}) {
                if (b == null || b.isEmpty()) continue;
                Net.Res r = Net.once(b, "POST", "/sync/bookmarks", body, 3000, 15000);
                if (r.status == 200) {
                    try { writeBookmarks(this, new JSONObject(new String(r.body, StandardCharsets.UTF_8)).getJSONArray("items").toString()); } catch (Exception ignored) { }
                    break;
                }
                if (r.status > 0) break;
            }
        }).start();
    }

    /* ---------------- 🔑: fill in a password imported into the phone (a choice when there's more than one for the site) */
    private void fillPassword() {
        String url = web.getUrl();
        java.util.List<Passwords.Login> list = url == null ? new java.util.ArrayList<>() : Passwords.forSite(this, url);
        if (list.isEmpty()) { toast("No saved password for this site"); return; }
        if (list.size() == 1) { fill(list.get(0)); return; }
        String[] names = new String[list.size()];
        for (int i = 0; i < names.length; i++) names[i] = list.get(i).user.isEmpty() ? "(no username)" : list.get(i).user;
        new android.app.AlertDialog.Builder(act).setTitle("Sign in as").setItems(names, (d, i) -> fill(list.get(i))).show();
    }
    private static final String FILL_JS = "((u,p)=>{const vis=e=>e&&e.offsetParent!==null&&!e.disabled;const set=(e,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,v);"
            + "e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};"
            + "const pw=[...document.querySelectorAll('input[type=password]')].find(vis);"
            + "const all=[...document.querySelectorAll('input')].filter(e=>vis(e)&&/^(text|email|tel|)$/i.test(e.type)&&!/search/i.test(e.name+e.id));"
            + "let user=pw?all.filter(e=>e.compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING).pop():all.find(e=>/user|email|login/i.test(e.name+e.id+e.autocomplete))||all[0];"
            + "if(user&&u)set(user,u);if(pw){set(pw,p);pw.focus()}return !!(pw||user)})";
    private void fill(Passwords.Login l) {
        try {
            String pw = Passwords.open(l.secret);
            web.evaluateJavascript(FILL_JS + "(" + JSONObject.quote(l.user) + "," + JSONObject.quote(pw) + ")", v -> { if (!"true".equals(v)) toast("Couldn't find a sign-in form on this page"); });
        } catch (Exception e) { toast("Couldn't unlock that password"); }
    }

    private boolean swapMode = false;      // the second page: "split" (one above the other) or "swap" (one at a time)

    /** ⧉: a second page under this one (like Firefox's split view); pressed again, back to one: the half you're using stays.
     *  ⇄ (swap): a second page in place of this one; pressed again, back to the other (✕ closes the one you're on). */
    private void split() {
        if (swapMode) { swap(); return; }
        if (webB == null) {
            webB = makeWeb();
            boxB = box(webB);
            divider = new View(this);
            android.graphics.drawable.GradientDrawable grip = new android.graphics.drawable.GradientDrawable();
            grip.setColor(markOff);
            grip.setCornerRadius(dp(3));
            android.graphics.drawable.LayerDrawable bg = new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[]{new android.graphics.drawable.ColorDrawable(rootView.getBackground() instanceof android.graphics.drawable.ColorDrawable ? ((android.graphics.drawable.ColorDrawable) rootView.getBackground()).getColor() : NIGHT), grip});
            bg.setLayerGravity(1, Gravity.CENTER);
            bg.setLayerSize(1, dp(48), dp(5));
            divider.setBackground(bg);
            divider.setOnTouchListener((v, e) -> {
                if (e.getAction() == android.view.MotionEvent.ACTION_MOVE) {
                    int[] at = new int[2];
                    panes.getLocationOnScreen(at);
                    float f = Math.max(0.2f, Math.min(0.8f, (e.getRawY() - at[1]) / Math.max(1, panes.getHeight())));
                    ((LinearLayout.LayoutParams) boxA.getLayoutParams()).weight = f;
                    ((LinearLayout.LayoutParams) boxB.getLayoutParams()).weight = 1 - f;
                    panes.requestLayout();
                }
                return true;
            });
            panes.addView(divider, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(14)));
            panes.addView(boxB, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
            ((LinearLayout.LayoutParams) boxA.getLayoutParams()).weight = 1;
            splitBtn.setAlpha(1f);
            splitBtn.setText("▣");
            setActive(webB);
            webB.loadDataWithBaseURL("https://babel.invalid/", pickerHtml(), "text/html", "utf-8", null);
            address.requestFocus();
            return;
        }
        unsplit();
    }

    private void swap() {
        if (webB == null) {
            webB = makeWeb();
            boxB = box(webB);
            panes.addView(boxB, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
            boxA.setVisibility(View.GONE);
            setActive(webB);
            paintSwap();
            webB.loadDataWithBaseURL("https://babel.invalid/", pickerHtml(), "text/html", "utf-8", null);
            address.requestFocus();
            return;
        }
        boolean toA = web == webB;
        boxA.setVisibility(toA ? View.VISIBLE : View.GONE);
        boxB.setVisibility(toA ? View.GONE : View.VISIBLE);
        editing = false;
        address.clearFocus();
        setActive(toA ? webA : webB);
        paintSwap();
    }

    /** ⇄ says which page you're on: 1 or 2 */
    private void paintSwap() {
        splitBtn.setText(webB == null ? "⇄" : web == webA ? "⇄1" : "⇄2");
    }

    /** back to one page: the one you're using stays */
    private void unsplit() {
        WebView keep = web, drop = web == webA ? webB : webA;
        panes.removeAllViews();
        ((android.view.ViewGroup) keep.getParent()).removeView(keep);
        going.remove(drop); current.remove(drop);
        drop.destroy();
        webA = keep; webB = null; boxB = null; divider = null;
        boxA = box(keep);
        panes.addView(boxA, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        splitBtn.setText(swapMode ? "⇄" : "⧉");
        editing = false;
        address.clearFocus();
        setActive(keep);
    }

    /** What the new half shows first: your latest pages, or type in the bar. */
    private String pickerHtml() {
        StringBuilder rows = new StringBuilder();
        try {
            JSONArray a = new JSONArray(readHistory(this));
            Set<String> seen = new HashSet<>();
            String here = webA.getUrl() == null ? "" : webA.getUrl();
            for (int i = a.length() - 1; i >= 0 && seen.size() < 8; i--) {
                JSONObject o = a.getJSONObject(i);
                String u = o.optString("url");
                if (u.isEmpty() || u.equals(here) || !seen.add(u)) continue;
                String t = o.optString("title", u);
                rows.append("<a href=\"").append(android.text.TextUtils.htmlEncode(u)).append("\"><b>").append(android.text.TextUtils.htmlEncode(t))
                        .append("</b><small>").append(android.text.TextUtils.htmlEncode(Uri.parse(u).getHost() == null ? u : Uri.parse(u).getHost())).append("</small></a>");
            }
        } catch (Exception ignored) { }
        String on = String.format("#%06X", markOn & 0xFFFFFF);
        return "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><style>body{margin:0;padding:18px 16px;font:15px system-ui,sans-serif;background:#f6f7fb;color:#1b2340}"
                + "h1{font-size:1.15rem;margin:0 0 4px}p{margin:0 0 14px;color:#5b6b86;font-size:.9rem}a{display:flex;flex-direction:column;gap:2px;padding:11px 14px;margin-bottom:8px;border-radius:14px;background:#fff;color:inherit;text-decoration:none;border-left:5px solid " + on + ";box-shadow:0 2px 8px rgba(0,0,0,.08)}"
                + "b{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}small{color:#7a869e}</style>"
                + "<h1>" + (swapMode ? "Your second page" : "The other half") + "</h1><p>" + "Search or type an address in the bar above" + (rows.length() > 0 ? ", or pick one of your latest pages:" : ".") + "</p>" + rows;
    }

    /** The engine pauses a page's video as soon as its window is hidden (screen off, another app): while something
     *  is playing, the page is kept "on screen" so it carries on. */
    private class PageView extends WebView {
        PageView(Context c) { super(c); }
        // (the screen going off reports the window as GONE, not just hidden)
        @Override protected void onWindowVisibilityChanged(int v) {
            super.onWindowVisibilityChanged(keeping && !isFinishing() ? View.VISIBLE : v);
        }
        @Override protected void onVisibilityChanged(View changed, int v) {
            super.onVisibilityChanged(changed, keeping && !isFinishing() ? View.VISIBLE : v);
        }
    }

    private WebView makeWeb() {
        WebView web = new PageView(this);
        web.setOnTouchListener((v, e) -> { if (e.getAction() == android.view.MotionEvent.ACTION_DOWN && v != this.web) setActive((WebView) v); return false; });
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(false);                  // "open in a new tab" links open here (one tab)
        s.setJavaScriptCanOpenWindowsAutomatically(false);   // pages can't open pop-ups by themselves
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) { if (v != BrowserPanel.this.web) return; progress.setProgress(p); progress.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE); }
            @Override public void onReceivedTitle(WebView v, String title) { remember(v.getUrl(), title); }
            @Override public void onShowCustomView(View view, CustomViewCallback cb) { showFull(view, cb); }
            @Override public void onHideCustomView() { hideFull(); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if (scheme.equals("http") || scheme.equals("https")) {
                    if (r.isForMainFrame()) going.put(v, u.getHost() == null ? "" : u.getHost());
                    return false;
                }
                try { startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;     // mail, phone, app links: handed to the right app
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                String host = r.getUrl().getHost();
                if (host == null || host.equals(going.get(v))) return null;
                String top = current.get(v);
                if (isBlocked(host, top == null ? "" : top)) return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null, new ByteArrayInputStream(new byte[0]));
                return null;
            }

            @Override
            public void onPageStarted(WebView v, String url, Bitmap icon) {
                Uri u = Uri.parse(url);
                String h = u.getHost() == null ? "" : u.getHost();
                current.put(v, h);
                going.put(v, h);
                ytAds(v, url);
                if (v == BrowserPanel.this.web) refreshBar();
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (!hideJs.isEmpty()) v.evaluateJavascript(hideJs, null);   // the empty boxes ads leave behind
                ytAds(v, url);
                if (v == BrowserPanel.this.web) refreshBar();
                remember(url, v.getTitle());
            }
        });
        return web;
    }

    private LinearLayout topLine;
    private final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            clock.setText(android.text.format.DateFormat.getTimeFormat(BrowserPanel.this).format(new java.util.Date()));
            ui.postDelayed(this, 10000);
        }
    };

    static final String DDG = "https://duckduckgo.com/?q=", WIKI = "https://en.wikipedia.org/w/index.php?search=";

    /** W: look up what's typed on Wikipedia; with nothing typed, the next search goes there. */
    private void wiki() {
        String t = address.getText().toString().trim();
        String cur = web.getUrl() == null ? "" : web.getUrl();
        if (!t.isEmpty() && !t.equals(cur)) { wikiNext = true; go(t); return; }
        wikiNext = true;
        wikiBtn.setTextColor(ACCENT);
        address.setText("");
        address.setHint("W  Search Wikipedia");
        address.requestFocus();
        ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(address, 0);
    }

    /** ⤓: the computer saves this page into the library as an article (to read offline; the address is kept). */
    private void savePage() {
        String url = web.getUrl();
        if (url == null || !url.startsWith("http")) { toast("Open an article first"); return; }
        String t = web.getTitle();
        new android.app.AlertDialog.Builder(act)
                .setTitle("Keep this page?")
                .setMessage((t == null || t.isEmpty() ? url : t) + "\n\nSave it in your library for good, or for 30 days? (You'll be asked before it's removed.)")
                .setPositiveButton("For good", (d, w) -> savePage(url, 0))
                .setNeutralButton("For 30 days", (d, w) -> savePage(url, 30))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void savePage(String url, int days) {
        saveBtn.setEnabled(false);
        saveBtn.setAlpha(0.5f);
        new Thread(() -> {
            String body;
            try { JSONObject o = new JSONObject().put("url", url); if (days > 0) o.put("days", days); body = o.toString(); } catch (Exception e) { body = "{}"; }
            Net.Res r = null;
            for (String b : new String[]{Net.current, Net.lan, Net.remote}) {
                if (b == null || b.isEmpty()) continue;
                r = Net.once(b, "POST", "/sync/savearticle", body, 3000, 20000);
                if (r.status > 0) break;
            }
            final Net.Res res = r;
            runOnUiThread(() -> {
                saveBtn.setEnabled(true);
                saveBtn.setAlpha(1f);
                if (res != null && res.status == 200) toast(days > 0 ? "Saving it for 30 days: it'll be under Articles after the next sync" : "Saving to your library: it'll be under Articles after the next sync");
                else if (res != null && res.status > 0) {
                    String msg = "Couldn't save it";
                    try { msg = new JSONObject(new String(res.body, StandardCharsets.UTF_8)).optString("error", msg); } catch (Exception ignored) { }
                    toast(msg);
                } else toast("Can't reach your computer right now");
            });
        }).start();
    }

    private void toast(String s) { android.widget.Toast.makeText(this, s, android.widget.Toast.LENGTH_LONG).show(); }

    void onResume() {
        live = new java.lang.ref.WeakReference<>(this);
        resumed = true;
        ui.removeCallbacks(watchMedia);
        ui.post(watchMedia);
    }

    /** An address, or words to search for on DuckDuckGo (or Wikipedia, after W). */
    private void go(String text) {
        String t = text.trim();
        if (t.isEmpty()) { address.requestFocus(); return; }
        String url;
        boolean w = wikiNext;
        wikiNext = false;
        wikiBtn.setTextColor(wikiInk);
        address.setHint(searchHint);
        if (!w && t.matches("(?i)^https?://.*")) url = t;
        else if (!w && !t.contains(" ") && t.matches("^[\\w-]+(\\.[\\w-]+)+(:\\d+)?(/.*)?$")) url = "https://" + t;
        else {
            try { url = (w ? WIKI : DDG) + URLEncoder.encode(t, "UTF-8"); } catch (Exception e) { url = t; }
        }
        editing = false;
        address.clearFocus();
        ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(address.getWindowToken(), 0);
        going.put(web, Uri.parse(url).getHost() == null ? "" : Uri.parse(url).getHost());
        if (fanOpen) fan(false);
        web.requestFocus();      // otherwise focus lands back on the address and it keeps the typed words
        editing = false;
        web.loadUrl(url);
    }

    /** History: one line per visit; a redirect a moment later on the same site counts as the same visit. */
    private void remember(String url, String title) {
        if (url == null || !url.startsWith("http") || url.startsWith("https://babel.invalid/")) return;    // (the split view's picker page)
        synchronized (LOCK) {
            try {
                File f = historyFile(this);
                JSONArray a = f.isFile() ? new JSONArray(new String(Net.readAll(new FileInputStream(f)), StandardCharsets.UTF_8)) : new JSONArray();
                long now = System.currentTimeMillis() / 1000;
                JSONObject last = a.length() > 0 ? a.getJSONObject(a.length() - 1) : null;
                String host = Uri.parse(url).getHost() == null ? "" : Uri.parse(url).getHost();
                boolean same = last != null && (last.optString("url").equals(url)
                        || (now - last.optLong("t") < 4 && site(host).equals(site(String.valueOf(Uri.parse(last.optString("url")).getHost())))));
                JSONObject e = same ? last : new JSONObject();
                e.put("url", url).put("t", now);
                if (title != null && !title.isEmpty() && !title.startsWith("http")) e.put("title", title);
                if (!same) a.put(e);
                JSONArray keep = a;
                if (a.length() > 3000) {           // the oldest visits make room
                    keep = new JSONArray();
                    for (int i = a.length() - 3000; i < a.length(); i++) keep.put(a.get(i));
                }
                File tmp = new File(f.getPath() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(keep.toString().getBytes(StandardCharsets.UTF_8)); }
                tmp.renameTo(f);
            } catch (Exception ignored) { }
        }
    }

    /** Back: leaves full screen, folds the orb's fan, or goes back a page; false when there's nowhere to go back to
     *  (the app then goes back itself, leaving this page open on the Browser tab). */
    boolean back() {
        if (fullView != null) { hideFull(); return true; }
        if (fanOpen) { fan(false); return true; }
        if (web.canGoBack()) { web.goBack(); return true; }
        return false;
    }

    /** The tab is closed (or the app is): the pages go. */
    void destroy() {
        closed = true;
        if (fullView != null) hideFull();
        ui.removeCallbacks(tick);
        ui.removeCallbacks(watchMedia);
        PlaybackService.stop(this);
        if (webA != null) webA.destroy();
        if (webB != null) webB.destroy();
        if (stage.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) stage.getParent()).removeView(stage);
    }
}
