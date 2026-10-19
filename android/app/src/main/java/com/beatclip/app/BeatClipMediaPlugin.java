package com.beatclip.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Bruecke zwischen der WebApp und den Android-Medien:
 *  - Media-Benachrichtigung / Sperrbildschirm / Bluetooth-Tasten
 *  - Audiodateien, die nach BeatClip geteilt wurden
 */
@CapacitorPlugin(name = "BeatClipMedia")
public class BeatClipMediaPlugin extends Plugin {

    private static final int CHUNK = 768 * 1024;      // Base64 in handlichen Stuecken

    private AudioHoldService.Listener mediaListener;
    private final Map<String, File> exportFiles = new ConcurrentHashMap<>();

    @Override
    public void load() {
        mediaListener = (action, positionMs) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            data.put("positionMs", positionMs);
            notifyListeners("mediaAction", data);
        };
        AudioHoldService.setListener(mediaListener);
    }

    @Override
    protected void handleOnDestroy() {
        AudioHoldService.setListener(null);
        super.handleOnDestroy();
    }

    /* ---------------- Media-Session / Benachrichtigung ---------------- */

    @PluginMethod
    public void startSession(PluginCall call) {
        String title = call.getString("title", "BeatClip");
        String artist = call.getString("artist", "");
        long duration = call.getLong("durationMs", 0L);
        boolean playing = call.getBoolean("playing", true);
        String artPath = writeArtToCache(call.getString("art"));
        AudioHoldService.update(getContext(), title, artist, playing, 0, duration, artPath);
        call.resolve();
    }

    /** data-URL (PNG) als Cache-Datei ablegen, damit das Intent klein bleibt. */
    private String writeArtToCache(String dataUrl) {
        if (dataUrl == null) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0 || dataUrl.length() - comma < 40) return null;
        try {
            byte[] bytes = Base64.getDecoder().decode(dataUrl.substring(comma + 1));
            File f = new File(getContext().getCacheDir(), "media_art.png");
            java.io.FileOutputStream out = new java.io.FileOutputStream(f);
            try { out.write(bytes); } finally { out.close(); }
            return f.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void updateSession(PluginCall call) {
        String title = call.getString("title", "BeatClip");
        String artist = call.getString("artist", "");
        boolean playing = call.getBoolean("playing", true);
        long position = call.getLong("positionMs", 0L);
        long duration = call.getLong("durationMs", 0L);
        AudioHoldService.update(getContext(), title, artist, playing, position, duration);
        call.resolve();
    }

    @PluginMethod
    public void stopSession(PluginCall call) {
        AudioHoldService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void notificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) { call.resolve(perm(true, false, false)); return; }
        boolean granted = ContextCompat.checkSelfPermission(getContext(),
                Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        boolean rationale = !granted && getActivity() != null
                && getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
        boolean permanentlyDenied = !granted && MainActivity.notifAsked && !rationale;
        call.resolve(perm(granted, rationale, permanentlyDenied));
    }

    private JSObject perm(boolean granted, boolean rationale, boolean permanentlyDenied) {
        JSObject o = new JSObject();
        o.put("granted", granted);
        o.put("rationale", rationale);
        o.put("permanentlyDenied", permanentlyDenied);
        return o;
    }

    /* ---------------- Geteilte Audiodateien ---------------- */

    @PluginMethod
    public void getSharedFiles(PluginCall call) {
        List<File> files = ShareInbox.list(getContext());
        JSArray arr = new JSArray();
        for (File f : files) {
            JSObject o = new JSObject();
            o.put("name", f.getName());
            o.put("size", f.length());
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("files", arr);
        call.resolve(ret);
    }

    /** Liest eine Datei in Stuecken (base64), damit grosse Titel nicht den Speicher sprengen. */
    @PluginMethod
    public void readSharedFile(PluginCall call) {
        String name = call.getString("name");
        long offset = call.getLong("offset", 0L);
        if (name == null) { call.reject("name fehlt"); return; }

        try {
            File dir = ShareInbox.dir(getContext()).getCanonicalFile();
            File f = new File(dir, name).getCanonicalFile();
            if (!f.toPath().startsWith(dir.toPath()) || !f.isFile()) { call.reject("Datei nicht gefunden"); return; }

            RandomAccessFile raf = new RandomAccessFile(f, "r");
            try {
                long len = raf.length();
                long at = Math.max(0, Math.min(offset, len));
                raf.seek(at);
                int n = (int) Math.min(CHUNK, len - at);
                byte[] buf = new byte[n];
                raf.readFully(buf);
                JSObject ret = new JSObject();
                ret.put("data", Base64.getEncoder().encodeToString(buf));
                ret.put("offset", at);
                ret.put("size", len);
                ret.put("eof", at + n >= len);
                call.resolve(ret);
            } finally {
                raf.close();
            }
        } catch (Exception e) {
            call.reject("Lesen fehlgeschlagen: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteSharedFile(PluginCall call) {
        String name = call.getString("name");
        if (name == null) { call.reject("name fehlt"); return; }
        try {
            File dir = ShareInbox.dir(getContext()).getCanonicalFile();
            File f = new File(dir, name).getCanonicalFile();
            if (f.toPath().startsWith(dir.toPath())) f.delete();
            call.resolve();
        } catch (Exception e) {
            call.reject("Loeschen fehlgeschlagen");
        }
    }

    @PluginMethod
    public void clearSharedFiles(PluginCall call) {
        for (File f : ShareInbox.list(getContext())) f.delete();
        call.resolve();
    }

    /* ---------------- Exportierter Audiokanal ---------------- */

    @PluginMethod
    public void beginAudioExport(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.trim().isEmpty() || name.contains("/") || name.contains("\\")) {
            call.reject("Ungueltiger Dateiname");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "audio_exports");
            if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("Exportordner konnte nicht erstellt werden");
            String id = java.util.UUID.randomUUID().toString();
            File file = new File(dir, id + ".wav");
            if (!file.createNewFile()) throw new java.io.IOException("Exportdatei konnte nicht angelegt werden");
            exportFiles.put(id, file);
            JSObject result = new JSObject();
            result.put("id", id);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Export konnte nicht vorbereitet werden: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeAudioExportChunk(PluginCall call) {
        String id = call.getString("id");
        String encoded = call.getString("data");
        Double rawOffset = call.getDouble("offset");
        File file = id == null ? null : exportFiles.get(id);
        if (file == null || encoded == null || rawOffset == null || rawOffset < 0
                || rawOffset > Long.MAX_VALUE) {
            call.reject("Ungueltiger Exportblock");
            return;
        }
        try (RandomAccessFile output = new RandomAccessFile(file, "rw")) {
            output.seek(rawOffset.longValue());
            output.write(Base64.getDecoder().decode(encoded));
            call.resolve();
        } catch (Exception e) {
            call.reject("Exportblock konnte nicht geschrieben werden: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveAudioExport(PluginCall call) {
        String id = call.getString("id");
        String name = call.getString("name");
        File file = id == null ? null : exportFiles.get(id);
        if (file == null || name == null || !file.isFile() || file.length() == 0) {
            call.reject("Exportdatei fehlt oder ist leer");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/wav");
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveAudioExportResult");
    }

    @PluginMethod
    public void cancelAudioExport(PluginCall call) {
        String id = call.getString("id");
        File file = id == null ? null : exportFiles.remove(id);
        if (file != null) file.delete();
        call.resolve();
    }

    @ActivityCallback
    private void saveAudioExportResult(PluginCall call, ActivityResult result) {
        String id = call.getString("id");
        File file = id == null ? null : exportFiles.remove(id);
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null
                || result.getData().getData() == null) {
            if (file != null) file.delete();
            call.reject("Speichern abgebrochen", "USER_CANCELLED");
            return;
        }
        if (file == null || !file.isFile()) {
            call.reject("Exportdatei ist nicht mehr verfuegbar");
            return;
        }
        Uri destination = result.getData().getData();
        new Thread(() -> {
            try (FileInputStream input = new FileInputStream(file);
                 OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new java.io.IOException("Zieldatei konnte nicht geoeffnet werden");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
                file.delete();
                call.resolve();
            } catch (Exception e) {
                file.delete();
                call.reject("Audiodatei konnte nicht gespeichert werden: " + e.getMessage());
            }
        }, "BeatClipAudioExport").start();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSArray names = new JSArray();
        for (File f : ShareInbox.list(getContext())) names.put(f.getName());
        JSObject o = new JSObject();
        o.put("serviceRunning", AudioHoldService.isRunning());
        o.put("shared", names);
        call.resolve(o);
    }
}
