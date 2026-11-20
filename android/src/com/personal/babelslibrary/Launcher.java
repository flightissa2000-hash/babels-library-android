package com.personal.babelslibrary;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.List;

/**
 * Babel as the phone's home screen: the other apps on the phone (the Add-ons tab), opening them, their icons, and
 * the "be my home screen / be my browser" choices (Android asks you itself; Babel can't take either on its own).
 */
final class Launcher {
    private Launcher() { }

    /** every app you can open: [{pkg, cls, label}], sorted by name (this app itself left out) */
    static String apps(Context c) {
        PackageManager pm = c.getPackageManager();
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> list = pm.queryIntentActivities(i, 0);
        JSONArray out = new JSONArray();
        try {
            for (ResolveInfo r : list) {
                if (r.activityInfo == null || c.getPackageName().equals(r.activityInfo.packageName)) continue;
                CharSequence l = r.loadLabel(pm);
                out.put(new JSONObject().put("pkg", r.activityInfo.packageName).put("cls", r.activityInfo.name)
                        .put("label", l == null ? r.activityInfo.packageName : l.toString()));
            }
        } catch (Exception ignored) { }
        return out.toString();
    }

    /** an app's icon as a PNG (kept in the cache; made again when the app is updated) */
    static File icon(Context c, String pkg, String cls) throws Exception {
        PackageManager pm = c.getPackageManager();
        long stamp = pm.getPackageInfo(pkg, 0).lastUpdateTime;
        File dir = new File(c.getCacheDir(), "appicons");
        if (!dir.exists()) dir.mkdirs();
        String name = (pkg + "_" + cls).replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.length() > 150) name = name.substring(0, 150);
        File f = new File(dir, name + "_" + stamp + ".png");
        if (f.isFile()) return f;
        Drawable d;
        try { d = pm.getActivityIcon(new ComponentName(pkg, cls)); } catch (Exception e) { d = pm.getApplicationIcon(pkg); }
        int s = 144;
        Bitmap b = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        d.setBounds(0, 0, s, s);
        d.draw(cv);
        File[] old = dir.listFiles((x, n) -> n.startsWith(name_(pkg, cls)));
        if (old != null) for (File o : old) o.delete();
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { b.compress(Bitmap.CompressFormat.PNG, 100, out); }
        tmp.renameTo(f);
        return f;
    }
    private static String name_(String pkg, String cls) {
        String name = (pkg + "_" + cls).replaceAll("[^A-Za-z0-9._-]", "_");
        return (name.length() > 150 ? name.substring(0, 150) : name) + "_";
    }

    /** an app's own icon by its package (for its notifications), as a PNG */
    static byte[] pkgIcon(Context c, String pkg) throws Exception {
        Drawable d = c.getPackageManager().getApplicationIcon(pkg);
        int s = 96;
        Bitmap b = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        d.setBounds(0, 0, s, s);
        d.draw(new Canvas(b));
        java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, o);
        return o.toByteArray();
    }

    /** open an app (its own screen, as from Samsung's home) */
    static boolean launch(Activity a, String pkg, String cls) {
        try {
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                    .setComponent(new ComponentName(pkg, cls))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            a.startActivity(i);
            return true;
        } catch (Exception e) {
            try {
                Intent i = a.getPackageManager().getLaunchIntentForPackage(pkg);
                if (i == null) return false;
                a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            } catch (Exception x) { return false; }
        }
    }

    /** Android's own page for an app (uninstall, permissions, storage) */
    static void info(Activity a, String pkg) {
        try {
            a.startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) { }
    }

    // ---- the phone's choices: home screen and browser

    static final String HOME = "home", BROWSER = "browser";
    private static String role(String which) {
        return HOME.equals(which) ? android.app.role.RoleManager.ROLE_HOME : android.app.role.RoleManager.ROLE_BROWSER;
    }

    /** is Babel the phone's home screen / browser right now? */
    static boolean isDefault(Context c, String which) {
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                android.app.role.RoleManager rm = c.getSystemService(android.app.role.RoleManager.class);
                if (rm != null && rm.isRoleAvailable(role(which))) return rm.isRoleHeld(role(which));
            } catch (Exception ignored) { }
        }
        Intent i = HOME.equals(which) ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                : new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"));
        ResolveInfo r = c.getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
        return r != null && r.activityInfo != null && c.getPackageName().equals(r.activityInfo.packageName);
    }

    static final int REQ_ROLE = 21;

    /** Android's own "make it the default" question (with nothing to ask, its settings page instead) */
    static void ask(Activity a, String which) {
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                android.app.role.RoleManager rm = a.getSystemService(android.app.role.RoleManager.class);
                if (rm != null && rm.isRoleAvailable(role(which)) && !rm.isRoleHeld(role(which))) {
                    a.startActivityForResult(rm.createRequestRoleIntent(role(which)), REQ_ROLE);
                    return;
                }
            } catch (Exception ignored) { }
        }
        settings(a, which);
    }

    /** the phone's settings page for the default home screen / apps (to switch back to Samsung's) */
    static void settings(Activity a, String which) {
        String[] tries = HOME.equals(which)
                ? new String[]{android.provider.Settings.ACTION_HOME_SETTINGS, android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, android.provider.Settings.ACTION_SETTINGS}
                : new String[]{android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, android.provider.Settings.ACTION_SETTINGS};
        for (String t : tries) {
            try { a.startActivity(new Intent(t).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; } catch (Exception ignored) { }
        }
    }

    /** Android's screen saver settings (Babel's sleep screen while charging is picked there) */
    static void dreamSettings(Activity a) {
        for (String t : new String[]{android.provider.Settings.ACTION_DREAM_SETTINGS, android.provider.Settings.ACTION_DISPLAY_SETTINGS}) {
            try { a.startActivity(new Intent(t).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; } catch (Exception ignored) { }
        }
    }

    /** is Babel's sleep screen the phone's screen saver? */
    static boolean isDream(Context c) {
        try {
            String s = android.provider.Settings.Secure.getString(c.getContentResolver(), "screensaver_components");
            return s != null && s.contains(c.getPackageName());
        } catch (Exception e) { return false; }
    }

    /** {level, charging} from the phone's last battery report */
    static JSONObject battery(Context c) {
        JSONObject o = new JSONObject();
        try {
            Intent b = c.registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b != null) {
                int lv = b.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1), sc = b.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100);
                int st = b.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
                o.put("level", lv < 0 ? -1 : Math.round(100f * lv / Math.max(1, sc)));
                o.put("charging", st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL
                        || b.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0) != 0);
            }
        } catch (Exception ignored) { }
        return o;
    }

    static byte[] read(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f)) { return Net.readAll(in); }
    }
}
