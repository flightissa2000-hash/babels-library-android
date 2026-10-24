package com.personal.babelslibrary;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;

/** Read-only access to a downloaded library file, for "Open in another app" (content://…files/library/<name>). */
public class FilesProvider extends ContentProvider {
    static final String AUTH = "com.personal.babelslibrary.files";

    static Uri uriFor(String name) {
        return Uri.parse("content://" + AUTH + "/library/" + Uri.encode(name));
    }

    private File file(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("[A-Za-z0-9_.-]{1,80}")) throw new FileNotFoundException();
        File f = new File(MainActivity.libraryDir(getContext()), name);
        if (!f.isFile()) throw new FileNotFoundException();
        return f;
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    static String typeFor(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
        String t = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        if (t == null && "cbr".equals(ext)) t = "application/vnd.comicbook-rar";
        if (t == null && "cbz".equals(ext)) t = "application/vnd.comicbook+zip";
        if (t == null && "mkv".equals(ext)) t = "video/x-matroska";
        return t == null ? "application/octet-stream" : t;
    }

    @Override
    public String getType(Uri uri) {
        String n = uri.getLastPathSegment();
        return typeFor(n == null ? "" : n);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String sel, String[] args, String sort) {
        try {
            File f = file(uri);
            MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            c.addRow(new Object[]{f.getName(), f.length()});
            return c;
        } catch (FileNotFoundException e) {
            return null;
        }
    }

    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
