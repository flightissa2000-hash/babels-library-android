package com.personal.babelslibrary;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * News → new events: every hour or so (whenever Android lets it, with a network) the phone asks the computer for
 * events its watcher found since the last look, and puts each one in the notification shade with Share and Open.
 * It only works while the computer can be reached (home Wi-Fi, or "Reach this library from anywhere").
 */
public class NewsAlerts extends JobService {
    static final int JOB = 41;
    private static final String CHANNEL = "news-events";
    private static Thread running;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("newsalerts", MODE_PRIVATE); }

    /** The page's Settings toggle. Switching it on starts the count from now (nothing old pours in). */
    static void set(Context c, boolean on) {
        SharedPreferences.Editor e = prefs(c).edit().putBoolean("on", on).putBoolean("tell", on);   // (the computer is told on the next look)
        if (on && since(c) == 0) e.putString("since", String.valueOf(System.currentTimeMillis() / 1000.0));
        e.apply();
        JobScheduler js = (JobScheduler) c.getSystemService(JOB_SCHEDULER_SERVICE);
        if (!on) { js.cancel(JOB); return; }
        schedule(c);
    }

    /** (Again each time the app opens: an update or a "force stop" can drop the schedule.) */
    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(JOB_SCHEDULER_SERVICE);
        if (js.getPendingJob(JOB) != null) return;
        js.schedule(new JobInfo.Builder(JOB, new ComponentName(c, NewsAlerts.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(60 * 60 * 1000L)
                .setPersisted(true)
                .build());
    }

    static boolean on(Context c) { return prefs(c).getBoolean("on", false); }

    private static double since(Context c) {
        try { return Double.parseDouble(prefs(c).getString("since", "0")); } catch (Exception e) { return 0; }
    }

    /** The pairing, kept so this can run with the app closed (the page hands it to Net only while it's open). */
    static void keepConn(Context c, JSONObject o) {
        prefs(c).edit().putString("conn", o.toString()).apply();
    }

    private static void loadConn(Context c) {
        if (!Net.token.isEmpty()) return;
        try {
            JSONObject o = new JSONObject(prefs(c).getString("conn", "{}"));
            Net.lan = o.optString("lan", "");
            Net.remote = o.optString("remote", "");
            Net.topic = o.optString("topic", "");
            Net.token = o.optString("token", "");
        } catch (Exception ignored) { }
    }

    @Override
    public boolean onStartJob(final JobParameters p) {
        if (!on(this)) return false;
        running = new Thread(() -> {
            try { check(this); } catch (Exception ignored) { }
            jobFinished(p, false);
        });
        running.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters p) { return true; }

    /** One look; also called when the app opens. */
    static void check(Context c) throws Exception {
        loadConn(c);
        if (Net.token.isEmpty()) return;
        if (prefs(c).getBoolean("tell", false)) {      // switch the computer's watcher on (it's what finds them)
            if (Net.call("POST", "/sync/news/alerts", "{\"on\":true}").status == 200) prefs(c).edit().putBoolean("tell", false).apply();
        }
        double since = since(c);
        Net.Res r = Net.call("GET", "/sync/news/alerts?since=" + since, null);
        if (r.status != 200) return;
        JSONObject o = new JSONObject(r.text());
        if (!o.optBoolean("on", true)) return;
        JSONArray items = o.optJSONArray("items");
        double top = since;
        if (items != null) for (int i = 0; i < items.length() && i < 8; i++) {
            JSONObject it = items.getJSONObject(i);
            notify(c, it);
            top = Math.max(top, it.optDouble("at", 0));
        }
        if (items != null) for (int i = 8; i < items.length(); i++) top = Math.max(top, items.getJSONObject(i).optDouble("at", 0));
        prefs(c).edit().putString("since", String.valueOf(top)).apply();
    }

    static void notify(Context c, JSONObject it) {
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "New events in the News", NotificationManager.IMPORTANCE_DEFAULT));
        String title = it.optString("title", "A new event"), link = it.optString("link", ""), src = it.optString("source", "");
        double d = it.optDouble("date", 0);
        String when = d > 0 ? android.text.format.DateFormat.getMediumDateFormat(c).format(new java.util.Date((long) (d * 1000))) : "";
        int id = 5000 + (link.hashCode() & 0xFFFF);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        Intent open = new Intent(c, BrowserActivity.class).putExtra(BrowserActivity.EXTRA_URL, link)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).setData(Uri.parse("babel-news://open/" + id));
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, title)
                .putExtra(Intent.EXTRA_TEXT, title + (when.isEmpty() ? "" : " (" + when + ")") + "\n" + link);
        Intent share = Intent.createChooser(send, "Share this event").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pOpen = PendingIntent.getActivity(c, id, open, flags);
        PendingIntent pShare = PendingIntent.getActivity(c, id + 1, share, flags);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.ic_menu_my_calendar)
                .setContentTitle("New event: " + title)
                .setContentText((when.isEmpty() ? "" : when + " · ") + src)
                .setStyle(new Notification.BigTextStyle().setBigContentTitle(title).bigText("A new event in the News" + (when.isEmpty() ? "" : " · " + when) + (src.isEmpty() ? "" : "\nfrom " + src)))
                .setAutoCancel(true)
                .setContentIntent(link.isEmpty() ? null : pOpen)
                .addAction(new Notification.Action.Builder(null, "Share", pShare).build());
        if (!link.isEmpty()) b.addAction(new Notification.Action.Builder(null, "Open", pOpen).build());
        try { nm.notify(id, b.build()); } catch (SecurityException ignored) { }   // (notifications turned off for the app)
    }
}
