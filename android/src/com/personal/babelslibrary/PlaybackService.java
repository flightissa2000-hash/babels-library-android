package com.personal.babelslibrary;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

/**
 * What's playing (a song in the jukebox, a video, or a video in the browser) keeps playing after you leave the app or
 * turn the screen off, with a media notification like a music app's: the playing chip in the status bar, the lock
 * screen and the notification shade all get ⏮/⏯/⏭ (or −10 s/⏯/+10 s for videos) and ✕ to stop.
 * The app's own player and the browser each say what they're playing; the latest one is shown.
 */
public class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final String CMD = "com.personal.babelslibrary.MEDIA_CMD";
    private static final int NOTE = 42;
    private static final long PAUSED_FOR = 15 * 60 * 1000L;       // paused this long: the notification goes

    /** What one source is playing. */
    static final class Now {
        final String source, title, artist, kind;
        final boolean playing;
        Now(String source, String title, String artist, String kind, boolean playing) {
            this.source = source; this.title = title == null ? "" : title; this.artist = artist == null ? "" : artist; this.kind = kind == null ? "video" : kind; this.playing = playing;
        }
    }

    private static PlaybackService self;
    private static Now app, browser;      // (what each says it's playing; set before the service is up, too)
    private static String shown = "app";

    private MediaSession session;
    private PowerManager.WakeLock cpu;
    private WifiManager.WifiLock wifi;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable idle = this::stopSelf;

    /* ---------------- the two sources */
    /** The browser: something plays (or was paused) on a page. */
    static void browser(Context c, String title, boolean playing) { set(c, new Now("browser", title, "In the browser", "video", playing)); }
    /** The app's own player: {title, artist, kind: "music"|"video", playing}. */
    static void app(Context c, String json) {
        try {
            JSONObject o = new JSONObject(json);
            set(c, new Now("app", o.optString("title"), o.optString("artist"), o.optString("kind", "music"), o.optBoolean("playing")));
        } catch (Exception ignored) { }
    }
    static void end(Context c, String source) {
        if ("app".equals(source)) app = null; else browser = null;
        if (app == null && browser == null) { if (self != null) self.stopSelf(); return; }
        shown = app != null ? "app" : "browser";
        if (self != null) self.paint();
    }
    /** (the browser closing: also what the old code called) */
    static void stop(Context c) { end(c, "browser"); }

    private static void set(Context c, Now n) {
        if ("app".equals(n.source)) app = n; else browser = n;
        if (n.playing || current() == null) shown = n.source;
        if (self != null) { self.paint(); return; }
        if (!n.playing) return;           // (only something playing starts it, and only while the app is on screen)
        Intent i = new Intent(c, PlaybackService.class);
        try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i); } catch (Exception ignored) { }
    }
    private static Now current() { return "app".equals(shown) ? app : browser; }

    /* ---------------- buttons: sent to whoever is shown */
    private void command(String cmd) {
        Now n = current();
        if (n == null) return;
        if ("browser".equals(n.source)) {
            BrowserPanel b = BrowserPanel.current();
            if (b != null) b.mediaCommand(cmd);
            if ("stop".equals(cmd)) end(this, "browser");
        } else {
            MainActivity.mediaCommand(cmd);
        }
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        self = this;
        session = new MediaSession(this, "Babel");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { command("play"); }
            @Override public void onPause() { command("pause"); }
            @Override public void onSkipToNext() { command("next"); }
            @Override public void onSkipToPrevious() { command("prev"); }
            @Override public void onFastForward() { command("fwd"); }
            @Override public void onRewind() { command("back"); }
            @Override public void onStop() { command("stop"); }
            @Override public void onSeekTo(long pos) { }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && CMD.equals(intent.getAction())) { command(intent.getStringExtra("cmd")); return START_NOT_STICKY; }
        paint();
        return START_NOT_STICKY;
    }

    private PendingIntent act(String cmd, int code) {
        return PendingIntent.getService(this, code, new Intent(this, PlaybackService.class).setAction(CMD).putExtra("cmd", cmd), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private static Notification.Action button(int icon, String label, PendingIntent p) {
        return new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource("android", icon), label, p).build();
    }

    /** The notification and the media session, for what's shown now. */
    void paint() {
        Now n = current();
        if (n == null) { stopSelf(); return; }
        boolean music = "music".equals(n.kind);
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, n.title.isEmpty() ? "Babel's Library" : n.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, n.artist).build());
        long acts = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP
                | (music ? PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS : PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_REWIND);
        session.setPlaybackState(new PlaybackState.Builder().setActions(acts)
                .setState(n.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, n.playing ? 1f : 0f).build());

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Playing", NotificationManager.IMPORTANCE_LOW));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        if ("browser".equals(n.source)) open.putExtra("browser", true);
        b.setSmallIcon(n.playing ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause)
                .setOngoing(n.playing).setOnlyAlertOnce(true).setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentTitle(n.title.isEmpty() ? "Babel's Library" : n.title)
                .setContentText(n.artist)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
                .setDeleteIntent(act("stop", 9));
        b.addAction(music ? button(android.R.drawable.ic_media_previous, "Previous", act("prev", 1)) : button(android.R.drawable.ic_media_rew, "Back 10 seconds", act("back", 1)));
        b.addAction(n.playing ? button(android.R.drawable.ic_media_pause, "Pause", act("pause", 2)) : button(android.R.drawable.ic_media_play, "Play", act("play", 2)));
        b.addAction(music ? button(android.R.drawable.ic_media_next, "Next", act("next", 3)) : button(android.R.drawable.ic_media_ff, "Forward 10 seconds", act("fwd", 3)));
        b.addAction(button(android.R.drawable.ic_menu_close_clear_cancel, "Stop", act("stop", 4)));
        b.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTE, b.build());
        } catch (Exception e) { nm.notify(NOTE, b.build()); }
        awake(n.playing);
        ui.removeCallbacks(idle);
        if (!n.playing) ui.postDelayed(idle, PAUSED_FOR);
    }

    /** the CPU and Wi-Fi stay up while something plays (screen off), and are let go while paused */
    private void awake(boolean on) {
        if (on) {
            if (cpu == null) {
                cpu = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "babel:playback");
                cpu.acquire(10 * 60 * 60 * 1000L);              // (let go after 10 hours at the most)
            }
            if (wifi == null) {
                wifi = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "babel:playback");
                wifi.acquire();
            }
        } else {
            if (cpu != null && cpu.isHeld()) cpu.release();
            if (wifi != null && wifi.isHeld()) wifi.release();
            cpu = null;
            wifi = null;
        }
    }

    @Override
    public void onDestroy() {
        ui.removeCallbacks(idle);
        awake(false);
        if (session != null) { session.setActive(false); session.release(); }
        if (self == this) self = null;
        // gone (✕, or paused too long): the players are told, so their own bars match
        if (app != null) MainActivity.mediaCommand("ended");
        app = null; browser = null;
        stopForeground(true);
        super.onDestroy();
    }
}
