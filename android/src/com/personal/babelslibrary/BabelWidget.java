package com.personal.babelslibrary;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Bundle;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/** The home-screen widget: the thing you opened last (cover, title, progress) and this week's Bulletin challenge.
 *  The page writes what to show to widget.json (Bridge.setWidget) whenever the library or the theme changes;
 *  a tap opens the app on that item (MainActivity reads EXTRA_OPEN). */
public class BabelWidget extends AppWidgetProvider {
    static final String EXTRA_OPEN = "widget_open", EXTRA_TAB = "widget_tab";

    /** redraw every copy of the widget on the home screen */
    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, BabelWidget.class));
        for (int id : ids) draw(c, m, id);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) draw(c, m, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle o) {
        draw(c, m, id);
    }

    private static JSONObject data(Context c) {
        File f = new File(c.getFilesDir(), "widget.json");
        if (!f.isFile()) return new JSONObject();
        try (FileInputStream in = new FileInputStream(f)) {
            return new JSONObject(new String(Net.readAll(in), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static int color(JSONObject t, String k, int def) {
        try { return Color.parseColor(t.optString(k)); } catch (Exception e) { return def; }
    }

    private static void draw(Context c, AppWidgetManager m, int wid) {
        JSONObject d = data(c), t = d.optJSONObject("theme"), it = d.optJSONObject("item"), ch = d.optJSONObject("challenge");
        if (t == null) t = new JSONObject();
        int bg = color(t, "bg", 0xFFFFF6E0), ink = color(t, "ink", 0xFF22304A), soft = color(t, "soft", 0xFF5A6478),
            accent = color(t, "accent", 0xFFFF6B4A), surface = color(t, "surface", 0xFFFFFFFF);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        v.setInt(R.id.w_bg, "setColorFilter", bg);
        v.setInt(R.id.w_chbg, "setColorFilter", surface);
        v.setTextColor(R.id.w_label, accent);
        v.setTextColor(R.id.w_title, ink);
        v.setTextColor(R.id.w_by, soft);
        v.setTextColor(R.id.w_pct, soft);
        v.setTextColor(R.id.w_chtext, ink);

        if (it != null) {
            int p = it.optInt("pct");
            v.setTextViewText(R.id.w_label, it.optString("label", "CONTINUE"));
            v.setTextViewText(R.id.w_title, it.optString("title"));
            v.setTextViewText(R.id.w_by, it.optString("by"));
            v.setTextViewText(R.id.w_pct, it.optString("note"));
            v.setImageViewBitmap(R.id.w_bar, bar(p, accent, (soft & 0x00FFFFFF) | 0x40000000));
            v.setViewVisibility(R.id.w_bar, View.VISIBLE);
            v.setImageViewBitmap(R.id.w_cover, cover(c, it));
            v.setViewVisibility(R.id.w_cover, View.VISIBLE);
            v.setOnClickPendingIntent(R.id.w_now, open(c, 1, it.optInt("id"), null));
        } else {
            v.setTextViewText(R.id.w_label, "BABEL'S LIBRARY");
            v.setTextViewText(R.id.w_title, "Nothing opened yet");
            v.setTextViewText(R.id.w_by, "Open the app to get started");
            v.setTextViewText(R.id.w_pct, "");
            v.setViewVisibility(R.id.w_bar, View.GONE);
            v.setViewVisibility(R.id.w_cover, View.GONE);
            v.setOnClickPendingIntent(R.id.w_now, open(c, 1, 0, null));
        }

        // short widget (one row of the home grid): just the book
        Bundle o = m.getAppWidgetOptions(wid);
        boolean tall = o == null || o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110) >= 100;
        if (ch != null && tall) {
            v.setTextViewText(R.id.w_chtext, ch.optString("text"));
            v.setViewVisibility(R.id.w_ch, View.VISIBLE);
            v.setOnClickPendingIntent(R.id.w_ch, open(c, 2, 0, "bulletin"));
        } else v.setViewVisibility(R.id.w_ch, View.GONE);
        m.updateAppWidget(wid, v);
    }

    private static PendingIntent open(Context c, int req, int item, String tab) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (item > 0) i.putExtra(EXTRA_OPEN, item);
        if (tab != null) i.putExtra(EXTRA_TAB, tab);
        i.setAction("widget." + req + "." + item);       // (a distinct action keeps each tap's extras)
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** the progress bar: a rounded track with the filled part in the theme's accent */
    private static Bitmap bar(int pct, int fill, int track) {
        int w = 400, h = 14;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(track);
        cv.drawRoundRect(new RectF(0, 0, w, h), h / 2f, h / 2f, p);
        if (pct > 0) {
            p.setColor(fill);
            cv.drawRoundRect(new RectF(0, 0, Math.max(h, w * Math.min(100, pct) / 100f), h), h / 2f, h / 2f, p);
        }
        return b;
    }

    /** the cover the app has already fetched; otherwise the title on a coloured cover, like the app shows */
    private static Bitmap cover(Context c, JSONObject it) {
        int id = it.optInt("id");
        File dir = new File(c.getCacheDir(), "covers");
        File[] fs = dir.listFiles((x, n) -> n.startsWith(id + "_"));
        Bitmap src = null;
        if (fs != null && fs.length > 0) src = BitmapFactory.decodeFile(fs[0].getPath());
        int w = 240, h = 360;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        RectF r = new RectF(0, 0, w, h);
        if (src != null) {
            // the cover, cropped to 2:3 with rounded corners
            android.graphics.BitmapShader sh = new android.graphics.BitmapShader(src, android.graphics.Shader.TileMode.CLAMP, android.graphics.Shader.TileMode.CLAMP);
            float s = Math.max(w / (float) src.getWidth(), h / (float) src.getHeight());
            android.graphics.Matrix mx = new android.graphics.Matrix();
            mx.setScale(s, s);
            mx.postTranslate((w - src.getWidth() * s) / 2f, (h - src.getHeight() * s) / 2f);
            sh.setLocalMatrix(mx);
            p.setShader(sh);
            cv.drawRoundRect(r, 14, 14, p);
            return b;
        }
        int col;
        try { col = Color.parseColor(it.optString("color")); } catch (Exception e) { col = 0xFF4AA8FF; }
        p.setColor(col);
        cv.drawRoundRect(r, 14, 14, p);
        TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        tp.setColor(Color.luminance(col) > 0.5f ? 0xFF111111 : Color.WHITE);
        tp.setTextSize(30);
        tp.setFakeBoldText(true);
        StaticLayout sl = StaticLayout.Builder.obtain(it.optString("title"), 0, it.optString("title").length(), tp, w - 36)
            .setAlignment(Layout.Alignment.ALIGN_CENTER).setMaxLines(6).setEllipsize(android.text.TextUtils.TruncateAt.END).build();
        cv.save();
        cv.translate(18, (h - sl.getHeight()) / 2f);
        sl.draw(cv);
        cv.restore();
        return b;
    }
}
