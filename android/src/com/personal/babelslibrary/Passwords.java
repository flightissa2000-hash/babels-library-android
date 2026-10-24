package com.personal.babelslibrary;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Passwords imported into the phone's browser (a CSV export from Chrome, Firefox, Bitwarden, 1Password...; the same
 * files the computer takes). Each password is encrypted with AES-GCM under a key kept in Android's hardware-backed
 * keystore: the key never leaves the phone's secure hardware, so the file (passwords.json, in the app's private
 * storage) is useless anywhere else. Usernames and sites are stored plainly so the browser can offer them.
 */
final class Passwords {
    private static final String ALIAS = "babel-passwords";
    private static final Object LOCK = new Object();

    static final class Login { String id, site, url, user; byte[] secret; }

    private static File file(Context c) { return new File(c.getFilesDir(), "passwords.json"); }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return g.generateKey();
    }

    private static byte[] seal(String text) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV(), body = c.doFinal(text.getBytes(StandardCharsets.UTF_8)), out = new byte[iv.length + body.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(body, 0, out, iv.length, body.length);
        return out;
    }

    static String open(byte[] blob) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, blob, 0, 12));
        return new String(c.doFinal(blob, 12, blob.length - 12), StandardCharsets.UTF_8);
    }

    /** example.com for https://login.example.com/path (logins are shared across a site's subdomains) */
    static String siteOf(String url) {
        try {
            String h = android.net.Uri.parse(url.contains("://") ? url : "https://" + url).getHost();
            if (h == null) return "";
            String[] p = h.toLowerCase(Locale.ROOT).replaceFirst("^www\\.", "").split("\\.");
            int n = p.length > 2 && p[p.length - 1].length() == 2 && p[p.length - 2].matches("co|com|net|org|ac|or|ne|go|gov|edu") ? 3 : 2;
            StringBuilder b = new StringBuilder();
            for (int i = Math.max(0, p.length - n); i < p.length; i++) { if (b.length() > 0) b.append('.'); b.append(p[i]); }
            return b.toString();
        } catch (Exception e) { return ""; }
    }

    static List<Login> all(Context c) {
        List<Login> out = new ArrayList<>();
        synchronized (LOCK) {
            File f = file(c);
            if (!f.isFile()) return out;
            try (FileInputStream in = new FileInputStream(f)) {
                JSONArray a = new JSONArray(new String(Net.readAll(in), StandardCharsets.UTF_8));
                for (int i = 0; i < a.length(); i++) {
                    JSONObject o = a.getJSONObject(i);
                    Login l = new Login();
                    l.id = o.optString("id"); l.site = o.optString("site"); l.url = o.optString("url"); l.user = o.optString("user");
                    l.secret = Base64.decode(o.optString("secret"), Base64.NO_WRAP);
                    out.add(l);
                }
            } catch (Exception ignored) { }
        }
        return out;
    }

    private static void write(Context c, List<Login> list) throws Exception {
        JSONArray a = new JSONArray();
        for (Login l : list) a.put(new JSONObject().put("id", l.id).put("site", l.site).put("url", l.url).put("user", l.user).put("secret", Base64.encodeToString(l.secret, Base64.NO_WRAP)));
        File f = file(c), tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(a.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); }
        if (!tmp.renameTo(f)) throw new Exception("couldn't save the passwords");
    }

    static List<Login> forSite(Context c, String url) {
        String s = siteOf(url);
        List<Login> out = new ArrayList<>();
        if (s.isEmpty()) return out;
        for (Login l : all(c)) if (s.equals(l.site)) out.add(l);
        return out;
    }

    static void clear(Context c) { synchronized (LOCK) { file(c).delete(); } }

    /* ---- CSV: the header names the address, username and password columns (quoted fields, commas and newlines inside quotes) */
    private static List<List<String>> csv(String text) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean q = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (q) {
                if (ch == '"') { if (i + 1 < text.length() && text.charAt(i + 1) == '"') { cell.append('"'); i++; } else q = false; }
                else cell.append(ch);
            } else if (ch == '"') q = true;
            else if (ch == ',') { row.add(cell.toString()); cell.setLength(0); }
            else if (ch == '\n' || ch == '\r') {
                if (ch == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                row.add(cell.toString()); cell.setLength(0); rows.add(row); row = new ArrayList<>();
            } else cell.append(ch);
        }
        if (cell.length() > 0 || !row.isEmpty()) { row.add(cell.toString()); rows.add(row); }
        return rows;
    }

    private static int col(List<String> head, String... names) {
        for (String n : names) { int i = head.indexOf(n); if (i >= 0) return i; }
        return -1;
    }

    /** {added, updated, skipped} */
    static int[] importCsv(Context c, String text) throws Exception {
        List<List<String>> rows = csv(text.replace("﻿", ""));
        if (rows.isEmpty()) throw new Exception("The file is empty.");
        List<String> head = new ArrayList<>();
        for (String h : rows.get(0)) head.add(h.trim().toLowerCase(Locale.ROOT));
        int cUrl = col(head, "url", "login_uri", "website", "web site", "origin", "login url", "uri", "hostname");
        int cUser = col(head, "username", "login_username", "user name", "login", "email", "user");
        int cPass = col(head, "password", "login_password", "pass");
        int cName = col(head, "name", "title");
        if (cUrl < 0 || cPass < 0) throw new Exception("This doesn't look like a password export: it needs columns for the website address and the password.");
        int added = 0, updated = 0, skipped = 0;
        synchronized (LOCK) {
            List<Login> list = all(c);
            for (int r = 1; r < rows.size(); r++) {
                List<String> row = rows.get(r);
                String url = cUrl < row.size() ? row.get(cUrl).trim() : "", user = cUser >= 0 && cUser < row.size() ? row.get(cUser).trim() : "",
                        pw = cPass < row.size() ? row.get(cPass) : "";
                if (url.isEmpty() && cName >= 0 && cName < row.size()) url = row.get(cName).trim();
                String site = siteOf(url);
                if (url.isEmpty() || pw.isEmpty() || site.isEmpty()) { skipped++; continue; }
                Login hit = null;
                for (Login l : list) if (l.site.equals(site) && l.user.equals(user)) { hit = l; break; }
                if (hit != null) {
                    if (open(hit.secret).equals(pw)) { skipped++; continue; }
                    hit.secret = seal(pw); updated++;
                } else {
                    Login l = new Login();
                    l.id = Long.toString(System.nanoTime(), 36); l.site = site; l.url = url.contains("://") ? url : "https://" + url; l.user = user; l.secret = seal(pw);
                    list.add(l); added++;
                }
            }
            write(c, list);
        }
        return new int[]{added, updated, skipped};
    }
}
