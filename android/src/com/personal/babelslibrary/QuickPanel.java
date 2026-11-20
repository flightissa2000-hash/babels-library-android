package com.personal.babelslibrary;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;
import org.json.JSONObject;

/**
 * The quick panel (the face in the top bar): Wi-Fi, volume, brightness and battery, read and set the ways Android lets
 * an app. Brightness for the whole phone needs "Modify system settings" (asked once, on Android's own page); until
 * then only Babel's own screen gets brighter or dimmer. Wi-Fi can't be switched by apps any more: its tile opens
 * Android's own Wi-Fi panel.
 */
final class QuickPanel {
    private QuickPanel() { }

    static String status(Activity a) {
        JSONObject o = new JSONObject();
        try {
            // Wi-Fi / mobile data
            ConnectivityManager cm = a.getSystemService(ConnectivityManager.class);
            NetworkCapabilities nc = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
            boolean wifi = nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
            boolean cell = nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR);
            int bars = -1;
            if (wifi) {
                try {
                    @SuppressWarnings("deprecation")
                    int rssi = ((android.net.wifi.WifiManager) a.getApplicationContext().getSystemService(Context.WIFI_SERVICE)).getConnectionInfo().getRssi();
                    bars = rssi >= -55 ? 4 : rssi >= -66 ? 3 : rssi >= -77 ? 2 : rssi >= -88 ? 1 : 0;
                } catch (Exception ignored) { }
            }
            android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) a.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            o.put("wifi", new JSONObject().put("on", wm != null && wm.isWifiEnabled()).put("connected", wifi).put("bars", bars));
            o.put("cell", cell);
            o.put("online", nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
            // volume: media and ringer
            AudioManager am = a.getSystemService(AudioManager.class);
            if (am != null) {
                o.put("music", new JSONObject().put("v", am.getStreamVolume(AudioManager.STREAM_MUSIC)).put("max", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)));
                o.put("ring", new JSONObject().put("v", am.getStreamVolume(AudioManager.STREAM_RING)).put("max", am.getStreamMaxVolume(AudioManager.STREAM_RING))
                        .put("mode", am.getRingerMode() == AudioManager.RINGER_MODE_SILENT ? "silent" : am.getRingerMode() == AudioManager.RINGER_MODE_VIBRATE ? "vibrate" : "normal"));
            }
            // brightness (0..1) and whether Babel may set it for the whole phone
            boolean may = Build.VERSION.SDK_INT < 23 || Settings.System.canWrite(a);
            int b = Settings.System.getInt(a.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128);
            boolean auto = Settings.System.getInt(a.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, 0) == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC;
            float win = a.getWindow().getAttributes().screenBrightness;
            o.put("bright", new JSONObject().put("v", may || win < 0 ? Math.min(1, b / 255f) : win).put("auto", auto).put("system", may));
            o.put("battery", Launcher.battery(a));
            o.put("notifAccess", BabelNotifs.allowed(a));
        } catch (Exception ignored) { }
        return o.toString();
    }

    /** "music" or "ring", 0..max; false when Android said no (the ringer during Do Not Disturb) */
    static boolean setVolume(Activity a, String which, int v) {
        try {
            AudioManager am = a.getSystemService(AudioManager.class);
            int s = "ring".equals(which) ? AudioManager.STREAM_RING : AudioManager.STREAM_MUSIC;
            am.setStreamVolume(s, Math.max(0, Math.min(v, am.getStreamMaxVolume(s))), 0);
            return true;
        } catch (Exception e) { return false; }
    }

    /** 0..1: the whole phone's brightness when allowed (and auto-brightness off), otherwise Babel's own screen */
    static boolean setBrightness(Activity a, float f) {
        f = Math.max(0.02f, Math.min(1f, f));
        boolean may = Build.VERSION.SDK_INT < 23 || Settings.System.canWrite(a);
        if (may) {
            try {
                Settings.System.putInt(a.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
                Settings.System.putInt(a.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, Math.round(f * 255));
                setWindow(a, WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
                return true;
            } catch (Exception ignored) { }
        }
        setWindow(a, f);
        return false;
    }
    private static void setWindow(Activity a, float f) {
        WindowManager.LayoutParams lp = a.getWindow().getAttributes();
        lp.screenBrightness = f;
        a.getWindow().setAttributes(lp);
    }

    /** auto-brightness on or off (needs the same permission) */
    static boolean setAuto(Activity a, boolean on) {
        try {
            if (Build.VERSION.SDK_INT >= 23 && !Settings.System.canWrite(a)) return false;
            Settings.System.putInt(a.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, on ? Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC : Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            return true;
        } catch (Exception e) { return false; }
    }

    /** Android's own pages: "wifi" (its Wi-Fi panel), "write" (let Babel change brightness), "notif" (notification access),
     *  "sound", "display", "battery" */
    static void open(Activity a, String what) {
        Intent i;
        switch (what) {
            case "wifi": i = new Intent(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS); break;
            case "internet": i = new Intent(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_INTERNET_CONNECTIVITY : Settings.ACTION_WIRELESS_SETTINGS); break;
            case "write": i = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + a.getPackageName())); break;
            case "notif": i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS); break;
            case "sound": i = new Intent(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_VOLUME : Settings.ACTION_SOUND_SETTINGS); break;
            case "battery": i = new Intent(Intent.ACTION_POWER_USAGE_SUMMARY); break;
            default: i = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
        }
        try { a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { try { a.startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { } }
    }
}
