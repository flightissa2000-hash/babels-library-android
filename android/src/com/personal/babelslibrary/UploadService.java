package com.personal.babelslibrary;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.database.Cursor;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Sends files to the computer's library in the background: it keeps going when you leave the app (Android would
 * otherwise freeze it), shows its progress in the notification shade with a Cancel button, and picks up where it
 * stopped when the connection drops: the computer says how much it already has.
 */
public class UploadService extends Service {
    static final String CANCEL = "com.personal.babelslibrary.CANCEL_UPLOAD";
    private static final String CHANNEL = "uploads";
    private static final int NOTE = 42;
    private static final int PIECE = 8 * 1024 * 1024;

    static final class Upload {
        String id, name, state = "waiting", msg = "";
        Uri uri;
        long total, sent;
        boolean priv;                // "only me": hidden from the computer's other profiles
        volatile boolean cancelled;
    }

    private static final List<Upload> LIST = new ArrayList<>();
    private static Thread worker;

    /** Add files to send (from the picker or another app's Share). */
    static void add(Context c, List<Uri> uris) { add(c, uris, false); }

    static void add(Context c, List<Uri> uris, boolean priv) {
        synchronized (LIST) {
            for (Uri u : uris) {
                Upload up = new Upload();
                up.priv = priv;
                up.id = Long.toHexString(System.nanoTime()) + Integer.toHexString(new Random().nextInt(0xFFFFFF));
                up.uri = u;
                up.name = "file";
                up.total = -1;
                try (Cursor k = c.getContentResolver().query(u, null, null, null, null)) {
                    if (k != null && k.moveToFirst()) {
                        int ni = k.getColumnIndex(OpenableColumns.DISPLAY_NAME), si = k.getColumnIndex(OpenableColumns.SIZE);
                        if (ni >= 0 && k.getString(ni) != null) up.name = k.getString(ni);
                        if (si >= 0 && !k.isNull(si)) up.total = k.getLong(si);
                    }
                } catch (Exception ignored) { }
                try {   // files from the picker stay readable even if the app is restarted
                    c.getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) { }
                LIST.add(up);
            }
        }
        Intent i = new Intent(c, UploadService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static String json() {
        JSONArray a = new JSONArray();
        synchronized (LIST) {
            for (Upload u : LIST) {
                try {
                    a.put(new JSONObject().put("id", u.id).put("name", u.name).put("total", u.total).put("sent", u.sent)
                            .put("state", u.state).put("msg", u.msg));
                } catch (Exception ignored) { }
            }
        }
        return a.toString();
    }

    static void cancel(String id) {
        synchronized (LIST) {
            for (Upload u : LIST) if (u.id.equals(id)) {
                u.cancelled = true;
                if (!"sending".equals(u.state) && !"retrying".equals(u.state)) u.state = "cancelled";
            }
        }
    }

    /** Take finished, failed or cancelled ones off the list. */
    static void dismiss(String id) {
        synchronized (LIST) {
            LIST.removeIf(u -> u.id.equals(id) && !"sending".equals(u.state) && !"retrying".equals(u.state) && !"waiting".equals(u.state));
        }
    }

    static void retry(Context c, String id) {
        synchronized (LIST) {
            for (Upload u : LIST) if (u.id.equals(id) && ("failed".equals(u.state) || "cancelled".equals(u.state))) {
                u.state = "waiting";
                u.msg = "";
                u.cancelled = false;
                u.id = Long.toHexString(System.nanoTime()) + Integer.toHexString(new Random().nextInt(0xFFFFFF));
                u.sent = 0;
            }
        }
        Intent i = new Intent(c, UploadService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    private Upload next() {
        synchronized (LIST) {
            for (Upload u : LIST) if ("waiting".equals(u.state)) return u;
        }
        return null;
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && CANCEL.equals(intent.getAction())) {
            String id = intent.getStringExtra("id");
            if (id != null) cancel(id);
            return START_NOT_STICKY;
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Sending files to your computer", NotificationManager.IMPORTANCE_LOW));
        Notification n = note(null);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NOTE, n);
        synchronized (UploadService.class) {
            if (worker == null || !worker.isAlive()) {
                worker = new Thread(this::work, "babel-upload");
                worker.start();
            }
        }
        return START_NOT_STICKY;
    }

    private Notification note(Upload u) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.stat_sys_upload).setOngoing(true).setOnlyAlertOnce(true)
                .setContentIntent(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE));
        if (u == null) {
            b.setContentTitle("Sending to your computer").setContentText("Starting…");
            return b.build();
        }
        int pct = u.total > 0 ? (int) (100 * u.sent / u.total) : 0;
        b.setContentTitle("Sending " + u.name)
                .setContentText("retrying".equals(u.state) ? "Connection lost: trying again…" : pct + "% · " + mb(u.sent) + " of " + mb(u.total))
                .setProgress(100, pct, u.total <= 0);
        Intent c = new Intent(this, UploadService.class).setAction(CANCEL).putExtra("id", u.id);
        b.addAction(new Notification.Action.Builder(null, "Cancel", PendingIntent.getService(this, u.id.hashCode(), c,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build());
        return b.build();
    }

    private static String mb(long b) { return b >= 1e9 ? String.format("%.2f GB", b / 1e9) : (b / 1000000) + " MB"; }

    private void show(Upload u) {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTE, note(u));
    }

    private void work() {
        PowerManager.WakeLock wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "babel:upload");
        WifiManager.WifiLock wifi = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "babel:upload");
        wake.acquire(12 * 3600 * 1000L);
        wifi.acquire();
        try {
            Upload u;
            while ((u = next()) != null) send(u);
        } finally {
            if (wifi.isHeld()) wifi.release();
            if (wake.isHeld()) wake.release();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    /** Where the computer is with this file (it keeps what arrived, so a dropped connection loses nothing). */
    private long serverHas(Upload u) {
        Net.Res r = Net.call("GET", "/sync/upload?u=" + u.id, null);
        try { return r.status == 200 ? new JSONObject(r.text()).optLong("have", 0) : -1; } catch (Exception e) { return -1; }
    }

    private InputStream openAt(Upload u, File copy, long at) throws IOException {
        InputStream in = copy != null ? new FileInputStream(copy) : getContentResolver().openInputStream(u.uri);
        if (in == null) throw new IOException("can't open the file");
        long left = at;
        byte[] skip = new byte[1 << 16];
        while (left > 0) {            // some providers can't skip, so read past it
            long k = in.skip(left);
            if (k <= 0) {
                int r = in.read(skip, 0, (int) Math.min(skip.length, left));
                if (r < 0) break;
                k = r;
            }
            left -= k;
        }
        return in;
    }

    private void send(Upload u) {
        u.state = "sending";
        File copy = null;
        try {
            if (u.total <= 0) {      // the app it came from didn't say how big it is: copy it here to measure it
                copy = new File(getCacheDir(), "upload-" + u.id);
                try (InputStream in = getContentResolver().openInputStream(u.uri); FileOutputStream out = new FileOutputStream(copy)) {
                    if (in == null) throw new IOException("can't open the file");
                    byte[] b = new byte[1 << 16];
                    int k;
                    while ((k = in.read(b)) > 0) out.write(b, 0, k);
                }
                u.total = copy.length();
            }
            String q = "/sync/upload?u=" + u.id + "&name=" + Uri.encode(u.name) + "&total=" + u.total + (u.priv ? "&private=1" : "") + "&offset=";
            byte[] buf = new byte[PIECE];
            InputStream in = openAt(u, copy, 0);
            int tries = 0;
            try {
                while (u.sent < u.total) {
                    if (u.cancelled) { cancelled(u); return; }
                    int len = 0;
                    while (len < buf.length && u.sent + len < u.total) {
                        int k = in.read(buf, len, (int) Math.min(buf.length - len, u.total - u.sent - len));
                        if (k < 0) break;
                        len += k;
                    }
                    if (len == 0) throw new IOException("the file ended early");
                    while (true) {
                        if (u.cancelled) { cancelled(u); return; }
                        Net.Res r = Net.sendBytes(q + u.sent, buf, len);
                        JSONObject o = null;
                        try { o = new JSONObject(r.text()); } catch (Exception ignored) { }
                        if (r.status == 200 && o != null && !o.has("error")) { u.sent += len; tries = 0; u.state = "sending"; break; }
                        if (r.status == 200 && o != null && "offset".equals(o.optString("error"))) {
                            // out of step (a piece got through but its answer didn't): carry on from where the computer is
                            long have = o.optLong("have", 0);
                            in.close();
                            in = openAt(u, copy, have);
                            u.sent = have;
                            len = -1;
                            break;
                        }
                        if (r.status == 400 && o != null) { fail(u, o.optString("error")); return; }
                        if (++tries > 40) { fail(u, r.status == 0 ? "Can't reach your computer." : "The computer refused it (" + r.status + ")."); return; }
                        u.state = "retrying";
                        show(u);
                        try { Thread.sleep(Math.min(30000, 1500L * tries)); } catch (InterruptedException e) { return; }
                        long have = serverHas(u);        // after a dropped connection, ask where to carry on
                        if (have >= 0 && have != u.sent) {
                            in.close();
                            in = openAt(u, copy, have);
                            u.sent = have;
                            len = -1;
                            break;
                        }
                    }
                    if (len < 0) continue;
                    show(u);
                }
            } finally {
                in.close();
            }
            u.state = "done";
            show(u);
        } catch (Exception e) {
            fail(u, String.valueOf(e.getMessage()));
        } finally {
            if (copy != null) copy.delete();
        }
    }

    private void fail(Upload u, String msg) {
        u.state = "failed";
        u.msg = msg;
    }

    private void cancelled(Upload u) {
        u.state = "cancelled";
        Net.call("DELETE", "/sync/upload?u=" + u.id, null);   // the computer throws away what had arrived
    }
}
