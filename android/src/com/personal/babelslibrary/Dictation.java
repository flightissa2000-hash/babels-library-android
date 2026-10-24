package com.personal.babelslibrary;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import org.json.JSONObject;

import java.util.ArrayList;

/**
 * Dictation for phone notes, with Android's own speech recognition (the WebView has none). It keeps listening until
 * stop() (the recognizer ends a session at each pause, so it's restarted until then) and reports to the page as
 * {type: "state"|"partial"|"final"|"level"|"error", text}.
 */
final class Dictation implements RecognitionListener {
    interface Out { void send(String json); }

    static final int REQ = 21;
    private final Activity act;
    private final Out out;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private boolean on = false, listening = false, afterPermission = false;
    private int errors = 0;
    private long lastLevel = 0;

    Dictation(Activity act, Out out) { this.act = act; this.out = out; }

    private void emit(String type, String text) {
        try { out.send(new JSONObject().put("type", type).put("text", text == null ? "" : text).toString()); } catch (Exception ignored) { }
    }

    void start() {
        ui.post(() -> {
            if (act.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                afterPermission = true;
                act.requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, REQ);
                emit("state", "asking");
                return;
            }
            if (!SpeechRecognizer.isRecognitionAvailable(act)) {
                emit("error", "This phone has no speech recognition (Google's speech services provide it).");
                return;
            }
            on = true;
            errors = 0;
            emit("state", "on");
            if (!listening) listen();
        });
    }

    void stop() {
        ui.post(() -> {
            if (!on) return;                 // (a permission question still open keeps waiting for its answer)
            on = false;
            if (rec != null && listening) rec.stopListening();      // what was said so far still arrives, as "final"
            else emit("state", "off");
        });
    }

    void permissionResult(boolean granted) {
        if (!afterPermission) return;
        afterPermission = false;
        if (granted) emit("state", "allowed");                        // (hold the button again to talk)
        else emit("error", "Babel's Library needs the microphone to take dictation.");
    }

    void destroy() {
        on = false;
        if (rec != null) { rec.destroy(); rec = null; }
        listening = false;
    }

    private void listen() {
        if (rec == null) {
            rec = SpeechRecognizer.createSpeechRecognizer(act);
            rec.setRecognitionListener(this);
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, act.getPackageName());
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 3000L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 3000L);
        listening = true;
        rec.startListening(i);
    }

    private static String best(Bundle b) {
        ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return r == null || r.isEmpty() ? "" : r.get(0);
    }

    /** a session ended (a pause, or stop()): carry on listening while dictation is on */
    private void ended() {
        listening = false;
        if (on) ui.postDelayed(() -> { if (on && !listening) listen(); }, 120);
        else emit("state", "off");
    }

    @Override public void onReadyForSpeech(Bundle b) { emit("state", "listening"); }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float rms) {
        long now = System.currentTimeMillis();
        if (now - lastLevel < 90) return;
        lastLevel = now;
        emit("level", String.valueOf(Math.max(0f, Math.min(1f, (rms + 2f) / 12f))));
    }
    @Override public void onBufferReceived(byte[] buffer) { }
    @Override public void onEndOfSpeech() { }
    @Override public void onPartialResults(Bundle b) { String t = best(b); if (!t.isEmpty()) emit("partial", t); }
    @Override public void onEvent(int type, Bundle b) { }

    @Override public void onResults(Bundle b) {
        errors = 0;
        String t = best(b);
        if (!t.isEmpty()) emit("final", t);
        ended();
    }

    @Override public void onError(int code) {
        boolean quiet = code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                || code == SpeechRecognizer.ERROR_CLIENT || code == SpeechRecognizer.ERROR_RECOGNIZER_BUSY;
        if (code == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
            on = false;
            emit("error", "Babel's Library needs the microphone to take dictation.");
        } else if (!quiet && on && ++errors >= 3) {
            on = false;
            emit("error", code == SpeechRecognizer.ERROR_NETWORK || code == SpeechRecognizer.ERROR_NETWORK_TIMEOUT
                    ? "Dictation needs a connection (or the offline speech pack for your language)." : "Dictation stopped (speech error " + code + ").");
        }
        if (code == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && rec != null) { rec.destroy(); rec = null; }
        ended();
    }
}
