package com.personal.babelslibrary;

import android.app.Activity;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Other apps' home-screen widgets inside Babel (the Mail tab: Gmail's inbox widget). They're the real widgets, drawn
 * by their own apps, so tapping an email opens it in Gmail. Babel keeps which ones you added (prefs "widgets") and
 * lays them over the room the page gives it, one above the other.
 */
final class Widgets {
    private static final int HOST_ID = 4711;
    static final int REQ_BIND = 31, REQ_CONFIG = 32;

    private final Activity act;
    private final AppWidgetManager mgr;
    private final AppWidgetHost host;
    final FrameLayout dock;                 // laid over the page by MainActivity
    private final LinearLayout column;
    private int pending = -1;               // a widget being added (waiting on Android's "allow" or its own settings)
    Runnable onChanged;

    Widgets(Activity a) {
        act = a;
        mgr = AppWidgetManager.getInstance(a);
        host = new AppWidgetHost(a, HOST_ID);
        dock = new FrameLayout(a);
        column = new LinearLayout(a);
        column.setOrientation(LinearLayout.VERTICAL);
        dock.addView(column, new FrameLayout.LayoutParams(-1, -1));
        dock.setVisibility(View.INVISIBLE);
    }

    void start() { try { host.startListening(); } catch (Exception ignored) { } }
    void stop() { try { host.stopListening(); } catch (Exception ignored) { } }

    private JSONArray saved() {
        try { return new JSONArray(act.getSharedPreferences("widgets", Activity.MODE_PRIVATE).getString("ids", "[]")); } catch (Exception e) { return new JSONArray(); }
    }
    private void save(JSONArray a) { act.getSharedPreferences("widgets", Activity.MODE_PRIVATE).edit().putString("ids", a.toString()).apply(); }

    /** the widgets you can add: [{n, pkg, cls, label, app}], Gmail's first */
    String providers() {
        JSONArray out = new JSONArray();
        try {
            List<AppWidgetProviderInfo> all = new ArrayList<>(mgr.getInstalledProviders());
            all.sort((x, y) -> {
                boolean gx = x.provider.getPackageName().equals("com.google.android.gm"), gy = y.provider.getPackageName().equals("com.google.android.gm");
                if (gx != gy) return gx ? -1 : 1;
                return appLabel(x).compareToIgnoreCase(appLabel(y));
            });
            for (AppWidgetProviderInfo p : all) {
                out.put(new JSONObject().put("pkg", p.provider.getPackageName()).put("cls", p.provider.getClassName())
                        .put("label", p.loadLabel(act.getPackageManager())).put("app", appLabel(p)));
            }
        } catch (Exception ignored) { }
        return out.toString();
    }
    private String appLabel(AppWidgetProviderInfo p) {
        try { return act.getPackageManager().getApplicationLabel(act.getPackageManager().getApplicationInfo(p.provider.getPackageName(), 0)).toString(); }
        catch (Exception e) { return p.provider.getPackageName(); }
    }

    /** what a widget looks like (its preview picture, or the app's icon), as a PNG */
    byte[] preview(String pkg, String cls) {
        for (AppWidgetProviderInfo p : mgr.getInstalledProviders()) {
            if (!p.provider.getPackageName().equals(pkg) || !p.provider.getClassName().equals(cls)) continue;
            Drawable d = null;
            try { d = p.loadPreviewImage(act, act.getResources().getDisplayMetrics().densityDpi); } catch (Exception ignored) { }
            if (d == null) try { d = p.loadIcon(act, act.getResources().getDisplayMetrics().densityDpi); } catch (Exception ignored) { }
            if (d == null) return null;
            int w = Math.max(1, Math.min(600, d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : 200));
            int h = Math.max(1, Math.min(600, d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : 200));
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            d.setBounds(0, 0, w, h);
            d.draw(new Canvas(b));
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.PNG, 100, o);
            return o.toByteArray();
        }
        return null;
    }

    /** add a widget: Android asks you once to let Babel show widgets, then the widget may ask its own questions
     *  (Gmail: which account and folder) */
    void add(String pkg, String cls) {
        ComponentName cn = new ComponentName(pkg, cls);
        int id = host.allocateAppWidgetId();
        pending = id;
        if (mgr.bindAppWidgetIdIfAllowed(id, cn)) { configure(id); return; }
        Intent i = new Intent(AppWidgetManager.ACTION_APPWIDGET_BIND)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_PROVIDER, cn);
        act.startActivityForResult(i, REQ_BIND);
    }
    private void configure(int id) {
        AppWidgetProviderInfo info = mgr.getAppWidgetInfo(id);
        if (info != null && info.configure != null) {
            try { host.startAppWidgetConfigureActivityForResult(act, id, 0, REQ_CONFIG, null); return; }
            catch (Exception e) { /* (it can't be set up from here: it's added as it comes) */ }
        }
        keep(id);
    }
    private void keep(int id) {
        pending = -1;
        JSONArray a = saved();
        a.put(id);
        save(a);
        rebuild();
        if (onChanged != null) onChanged.run();
    }
    /** Android's answers (MainActivity passes them on) */
    boolean result(int req, int res) {
        if (req != REQ_BIND && req != REQ_CONFIG) return false;
        int id = pending;
        if (id < 0) return true;
        if (res != Activity.RESULT_OK) { host.deleteAppWidgetId(id); pending = -1; if (onChanged != null) onChanged.run(); return true; }
        if (req == REQ_BIND) configure(id); else keep(id);
        return true;
    }

    void remove(int id) {
        JSONArray a = saved(), b = new JSONArray();
        for (int i = 0; i < a.length(); i++) if (a.optInt(i) != id) b.put(a.optInt(i));
        save(b);
        try { host.deleteAppWidgetId(id); } catch (Exception ignored) { }
        rebuild();
    }

    /** move a widget up the column */
    void up(int id) {
        JSONArray a = saved();
        for (int i = 1; i < a.length(); i++) if (a.optInt(i) == id) { int t = a.optInt(i - 1); try { a.put(i - 1, id); a.put(i, t); } catch (Exception ignored) { } }
        save(a);
        rebuild();
    }

    /** the ones you added: [{id, label, app}] (a widget whose app was uninstalled is dropped) */
    String list() {
        JSONArray a = saved(), out = new JSONArray(), keepIds = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            AppWidgetProviderInfo info = mgr.getAppWidgetInfo(a.optInt(i));
            if (info == null) continue;
            keepIds.put(a.optInt(i));
            try { out.put(new JSONObject().put("id", a.optInt(i)).put("label", info.loadLabel(act.getPackageManager())).put("app", appLabel(info))); } catch (Exception ignored) { }
        }
        if (keepIds.length() != a.length()) save(keepIds);
        return out.toString();
    }

    private final java.util.Map<Integer, AppWidgetHostView> views = new java.util.HashMap<>();
    /** the column of widgets, made again from the saved list (views kept for the ones still there) */
    void rebuild() {
        column.removeAllViews();
        JSONArray a = saved();
        java.util.Set<Integer> live = new java.util.HashSet<>();
        float d = act.getResources().getDisplayMetrics().density;
        for (int i = 0; i < a.length(); i++) {
            int id = a.optInt(i);
            AppWidgetProviderInfo info = mgr.getAppWidgetInfo(id);
            if (info == null) continue;
            live.add(id);
            AppWidgetHostView v = views.get(id);
            if (v == null) { v = host.createView(act.getApplicationContext(), id, info); views.put(id, v); }
            if (v.getParent() != null) ((android.view.ViewGroup) v.getParent()).removeView(v);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, 0, 1);
            if (column.getChildCount() > 0) lp.topMargin = Math.round(10 * d);
            column.addView(v, lp);
        }
        for (Integer id : new ArrayList<>(views.keySet())) if (!live.contains(id)) views.remove(id);
        sizeAll();
    }
    /** tell each widget how big it is (in dp), so it lays itself out for it */
    private void sizeAll() {
        column.post(() -> {
            float d = act.getResources().getDisplayMetrics().density;
            for (AppWidgetHostView v : views.values()) {
                int w = Math.round(v.getWidth() / d), h = Math.round(v.getHeight() / d);
                if (w <= 0 || h <= 0) continue;
                Bundle o = new Bundle();
                o.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, w);
                o.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, w);
                o.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, h);
                o.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, h);
                try { v.updateAppWidgetSize(o, w, h, w, h); } catch (Exception ignored) { }
            }
        });
    }
    void placed() { sizeAll(); }
    int count() { return saved().length(); }
}
