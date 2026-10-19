package com.beatclip.app;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * Nehmut Audiodateien entgegen, die aus anderen Apps nach BeatClip geteilt
 * oder mit BeatClip geoeffnet werden, und legt sie im App-Speicher ab.
 */
public final class ShareInbox {

    private static final long MAX_BYTES = 64L * 1024 * 1024;

    private ShareInbox() {}

    public static File dir(Context c) {
        File d = new File(c.getFilesDir(), "shared");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static void capture(Context c, Intent intent) {
        if (intent == null) return;
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) && intent.getClipData() != null) {
            for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                uris.add(intent.getClipData().getItemAt(i).getUri());
            }
        } else if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        }
        for (Uri u : uris) copyIn(c, u);
    }

    private static void copyIn(Context c, Uri uri) {
        if (uri == null) return;
        String name = displayName(c, uri);
        if (name == null || name.isEmpty()) name = "geteilter-titel";
        name = sanitize(name);

        File target = new File(dir(c), name);
        long size = sizeOf(c, uri);
        if (size > MAX_BYTES) return;                    // zu gross: in der App importieren statt teilen

        try (InputStream in = c.getContentResolver().openInputStream(uri)) {
            if (in == null) return;
            try (OutputStream out = new FileOutputStream(target)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        } catch (Exception ignored) {}
    }

    public static List<File> list(Context c) {
        File[] files = dir(c).listFiles();
        List<File> out = new ArrayList<>();
        if (files == null) return out;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File f : files) if (f.isFile()) out.add(f);
        return out;
    }

    private static String displayName(Context c, Uri uri) {
        try (Cursor cur = c.getContentResolver().query(uri, new String[]{ OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                int idx = cur.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return cur.getString(idx);
            }
        } catch (Exception ignored) {}
        String last = uri.getLastPathSegment();
        return last == null ? null : last;
    }

    private static long sizeOf(Context c, Uri uri) {
        try (Cursor cur = c.getContentResolver().query(uri, new String[]{ OpenableColumns.SIZE }, null, null, null)) {
            if (cur != null && cur.moveToFirst() && !cur.isNull(0)) return cur.getLong(0);
        } catch (Exception ignored) {}
        return -1;
    }

    private static String sanitize(String s) {
        String n = s.replaceAll("[^A-Za-z0-9._ -]+", "_").replaceAll("\\s+", " ").trim();
        if (n.length() > 120) n = n.substring(n.length() - 120);
        return n.isEmpty() ? "geteilter-titel" : n;
    }
}
