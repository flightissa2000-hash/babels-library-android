package com.personal.babelslibrary;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps a video or song in the browser playing after you leave it or turn the screen off (to fall asleep to a
 * YouTube video): a quiet "playing" notification, the CPU and Wi-Fi kept awake while it lasts, and Stop to end it.
 * The browser starts it when it goes to the background with something playing, and ends it when you come back.
 */
public class PlaybackService extends Service {
    static final String STOP = "com.personal.babelslibrary.STOP_PLAYBACK";
    private static final String CHANNEL = "playback";
    private static final int NOTE = 42;
    private PowerManager.WakeLock cpu;
    private WifiManager.WifiLock wifi;

    static void start(Context c, String title) {
        Intent i = new Intent(c, PlaybackService.class).putExtra("title", title == null ? "" : title);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) { c.stopService(new Intent(c, PlaybackService.class)); }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            BrowserActivity b = BrowserActivity.current();
            if (b != null) b.pauseMedia();
            stopSelf();
            return START_NOT_STICKY;
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Playing in the browser", NotificationManager.IMPORTANCE_LOW));
        String title = intent == null ? "" : intent.getStringExtra("title");
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_media_play).setOngoing(true).setOnlyAlertOnce(true)
                .setContentTitle(title == null || title.isEmpty() ? "Playing in Babel's Library" : title)
                .setContentText("Keeps playing with the screen off · tap to go back")
                .setContentIntent(PendingIntent.getActivity(this, 0, new Intent(this, BrowserActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT), PendingIntent.FLAG_IMMUTABLE))
                .addAction(new Notification.Action.Builder(null, "Stop", PendingIntent.getService(this, 1,
                        new Intent(this, PlaybackService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)).build());
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTE, b.build());
        if (cpu == null) {
            cpu = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "babel:playback");
            cpu.acquire(10 * 60 * 60 * 1000L);              // (let go after 10 hours at the most)
        }
        if (wifi == null) {
            wifi = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "babel:playback");
            wifi.acquire();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (cpu != null && cpu.isHeld()) cpu.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        cpu = null;
        wifi = null;
        super.onDestroy();
    }
}
