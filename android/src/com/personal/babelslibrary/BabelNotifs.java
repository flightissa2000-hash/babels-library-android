package com.personal.babelslibrary;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Other apps' notifications, listed in the quick panel (the face in the top bar): tap one to open it, ✕ to clear it.
 * Android only lets an app see them once you switch it on yourself (Settings → Notification access → Babel's Library).
 * Nothing is kept or sent anywhere: the list is read when the panel asks.
 */
public class BabelNotifs extends NotificationListenerService {
    private static volatile BabelNotifs live;

    @Override public void onListenerConnected() { live = this; MainActivity.notifsChanged(); }
    @Override public void onListenerDisconnected() { live = null; }
    @Override public void onNotificationPosted(StatusBarNotification sbn) { MainActivity.notifsChanged(); }
    @Override public void onNotificationRemoved(StatusBarNotification sbn) { MainActivity.notifsChanged(); }

    /** has notification access been switched on for Babel? */
    static boolean allowed(Context c) {
        String s = android.provider.Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        return s != null && s.contains(new ComponentName(c, BabelNotifs.class).flattenToString());
    }

    /** [{key, pkg, app, title, text, when, clear}] newest first (not Babel's own, not group summaries) */
    static String list(Context c) {
        JSONArray out = new JSONArray();
        BabelNotifs n = live;
        if (n == null) return out.toString();
        try {
            StatusBarNotification[] all = n.getActiveNotifications();
            java.util.Arrays.sort(all, (x, y) -> Long.compare(y.getPostTime(), x.getPostTime()));
            PackageManager pm = c.getPackageManager();
            for (StatusBarNotification sbn : all) {
                Notification no = sbn.getNotification();
                if (c.getPackageName().equals(sbn.getPackageName()) || (no.flags & Notification.FLAG_GROUP_SUMMARY) != 0) continue;
                Bundle e = no.extras;
                CharSequence title = e.getCharSequence(Notification.EXTRA_TITLE), text = e.getCharSequence(Notification.EXTRA_BIG_TEXT);
                if (text == null) text = e.getCharSequence(Notification.EXTRA_TEXT);
                if (title == null && text == null) continue;
                if (hidden(c, sbn.getKey(), title, text)) continue;
                String app;
                try { app = pm.getApplicationLabel(pm.getApplicationInfo(sbn.getPackageName(), 0)).toString(); } catch (Exception x) { app = sbn.getPackageName(); }
                out.put(new JSONObject().put("key", sbn.getKey()).put("pkg", sbn.getPackageName()).put("app", app)
                        .put("title", title == null ? "" : title.toString()).put("text", text == null ? "" : text.toString())
                        .put("when", sbn.getPostTime()).put("clear", sbn.isClearable()).put("open", no.contentIntent != null));
                if (out.length() >= 40) break;
            }
        } catch (Exception ignored) { }
        return out.toString();
    }

    private static StatusBarNotification find(String key) {
        BabelNotifs n = live;
        if (n == null) return null;
        try { for (StatusBarNotification s : n.getActiveNotifications()) if (s.getKey().equals(key)) return s; } catch (Exception ignored) { }
        return null;
    }

    /** open what the notification points to (as tapping it in the shade would) */
    static boolean open(String key) {
        StatusBarNotification s = find(key);
        if (s == null || s.getNotification().contentIntent == null) return false;
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                android.app.ActivityOptions o = android.app.ActivityOptions.makeBasic();
                o.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                s.getNotification().contentIntent.send(null, 0, null, null, null, null, o.toBundle());
            } else s.getNotification().contentIntent.send();
            if ((s.getNotification().flags & Notification.FLAG_AUTO_CANCEL) != 0) clear(key);
            return true;
        } catch (PendingIntent.CanceledException e) { return false; }
    }

    /**
     * Clear it. Some apps mark a notification as one other apps can't clear (Android refuses the cancel):
     * those are snoozed for a day where Android allows it, and hidden from Babel's list until they say something new.
     */
    static void clear(String key) {
        BabelNotifs n = live;
        if (n == null) return;
        StatusBarNotification s = find(key);
        if (s == null || s.isClearable()) { try { n.cancelNotification(key); } catch (Exception ignored) { } return; }
        Bundle e = s.getNotification().extras;
        CharSequence text = e.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (text == null) text = e.getCharSequence(Notification.EXTRA_TEXT);
        android.content.SharedPreferences p = n.getSharedPreferences("notifs_hidden", MODE_PRIVATE);
        android.content.SharedPreferences.Editor ed = p.edit();
        // forget hidden keys that are no longer showing, so the list doesn't grow
        java.util.Set<String> showing = new java.util.HashSet<>();
        try { for (StatusBarNotification x : n.getActiveNotifications()) showing.add(x.getKey()); } catch (Exception ignored) { }
        for (String k : p.getAll().keySet()) if (!showing.contains(k)) ed.remove(k);
        ed.putString(key, sig(e.getCharSequence(Notification.EXTRA_TITLE), text)).apply();
        if (Build.VERSION.SDK_INT >= 26) try { n.snoozeNotification(key, 24L * 3600 * 1000); } catch (Exception ignored) { }
        MainActivity.notifsChanged();
    }

    private static String sig(CharSequence title, CharSequence text) { return (title == null ? "" : title) + "\n" + (text == null ? "" : text); }

    private static boolean hidden(Context c, String key, CharSequence title, CharSequence text) {
        String h = c.getSharedPreferences("notifs_hidden", MODE_PRIVATE).getString(key, null);
        return h != null && h.equals(sig(title, text));
    }
}
