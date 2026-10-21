package com.beatclip.app;

import android.Manifest;
import android.content.Intent;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
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
    private final Map<String, File> encodeWavFiles = new ConcurrentHashMap<>();

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
        openSaveDialog(call, id, name, call.getString("mime", "audio/wav"));
    }

    /** Oeffnet den System-Speicherdialog fuer die fertige Export-/Encodedatei. */
    private void openSaveDialog(PluginCall call, String id, String name, String mime) {
        File file = id == null ? null : exportFiles.get(id);
        if (file == null || name == null || !file.isFile() || file.length() == 0) {
            call.reject("Exportdatei fehlt oder ist leer");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
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

    /* ---------------- M4A-Encode (Kanäle -> AAC/MP4) ----------------
       Die Web-Seite liefert denselben WAV-Stream wie beim reinen WAV-Export;
       hier wird er mit MediaCodec (AAC) + MediaMuxer in eine MP4-Datei
       umgewandelt und dann ueber den System-Speicherdialog gesichert.     */

    @PluginMethod
    public void beginAudioEncode(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.trim().isEmpty() || name.contains("/") || name.contains("\\")) {
            call.reject("Ungueltiger Dateiname");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "audio_encodes");
            if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("Encodeordner konnte nicht erstellt werden");
            String id = java.util.UUID.randomUUID().toString();
            File file = new File(dir, id + ".wav");
            if (!file.createNewFile()) throw new java.io.IOException("Encodedatei konnte nicht angelegt werden");
            encodeWavFiles.put(id, file);
            JSObject result = new JSObject();
            result.put("id", id);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Encode konnte nicht vorbereitet werden: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeAudioEncodeChunk(PluginCall call) {
        String id = call.getString("id");
        String encoded = call.getString("data");
        Double rawOffset = call.getDouble("offset");
        File file = id == null ? null : encodeWavFiles.get(id);
        if (file == null || encoded == null || rawOffset == null || rawOffset < 0
                || rawOffset > Long.MAX_VALUE) {
            call.reject("Ungueltiger Encodeblock");
            return;
        }
        try (RandomAccessFile output = new RandomAccessFile(file, "rw")) {
            output.seek(rawOffset.longValue());
            output.write(Base64.getDecoder().decode(encoded));
            call.resolve();
        } catch (Exception e) {
            call.reject("Encodeblock konnte nicht geschrieben werden: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelAudioEncode(PluginCall call) {
        String id = call.getString("id");
        File file = id == null ? null : encodeWavFiles.remove(id);
        if (file != null) file.delete();
        call.resolve();
    }

    @PluginMethod
    public void finishAudioEncode(PluginCall call) {
        String id = call.getString("id");
        String name = call.getString("name");
        File wav = id == null ? null : encodeWavFiles.get(id);
        if (wav == null || name == null || !wav.isFile() || wav.length() < 45) {
            call.reject("Encodedatei fehlt oder ist zu kurz");
            return;
        }
        // Die WAV-Blob ist komplett uebertragen, also aus der Tabelle nehmen;
        // das Ergebnis kommt in exportFiles, damit der Speicherdialog sie findet.
        encodeWavFiles.remove(id);
        new Thread(() -> {
            File m4a = null;
            try {
                m4a = encodeWavToM4a(wav);
                wav.delete();
                String encodeId = java.util.UUID.randomUUID().toString();
                exportFiles.put(encodeId, m4a);
                execute(() -> openSaveDialog(call, encodeId, name, "audio/mp4"));
            } catch (Exception e) {
                if (wav != null) wav.delete();
                if (m4a != null) m4a.delete();
                call.reject("M4A-Encoding fehlgeschlagen: " + e.getMessage());
            }
        }, "BeatClipM4aEncode").start();
    }

    private File encodeWavToM4a(File wav) throws Exception {
        try (RandomAccessFile in = new RandomAccessFile(wav, "r")) {
            byte[] riff = new byte[4];
            in.readFully(riff);
            if (!"RIFF".equals(new String(riff))) throw new java.io.IOException("Kein RIFF/WAVE");
            in.seek(8);
            byte[] wave = new byte[4];
            in.readFully(wave);
            if (!"WAVE".equals(new String(wave))) throw new java.io.IOException("Kein WAVE-Header");
            in.seek(20);
            byte[] fmt = new byte[16];
            in.readFully(fmt);
            int audioFormat = (fmt[0] & 0xff) | ((fmt[1] & 0xff) << 8);
            int channels = (fmt[2] & 0xff) | ((fmt[3] & 0xff) << 8);
            long sampleRate = (fmt[4] & 0xffL) | ((fmt[5] & 0xffL) << 8)
                    | ((fmt[6] & 0xffL) << 16) | ((fmt[7] & 0xffL) << 24);
            if (audioFormat != 1) throw new java.io.IOException("Nur unkomprimierte PCM-WAVs werden unterstuetzt");
            if (channels < 1 || channels > 8) throw new java.io.IOException("Ungueltige Kanalzahl");
            if (sampleRate <= 0) throw new java.io.IOException("Ungueltige Samplerate");

            int dataOffset = 44;
            in.seek(36);
            while (in.getFilePointer() + 8 <= in.length()) {
                byte[] ck = new byte[8];
                in.readFully(ck);
                String id = new String(ck, 0, 4);
                long size = (ck[4] & 0xffL) | ((ck[5] & 0xffL) << 8)
                        | ((ck[6] & 0xffL) << 16) | ((ck[7] & 0xffL) << 24);
                if ("data".equals(id)) { dataOffset = (int) in.getFilePointer(); break; }
                in.seek(in.getFilePointer() + size + (size % 2));
            }
            long dataBytes = in.length() - dataOffset;
            return encodePcmToM4a(in, dataOffset, dataBytes, channels, sampleRate);
        }
    }

    private File encodePcmToM4a(RandomAccessFile pcm, int dataOffset, long dataBytes,
                                int channels, long sampleRate) throws Exception {
        int bitRate = (int) Math.min(320_000, Math.max(96_000, channels * sampleRate * 16 * 0.4));
        // Encoder-Format: AAC-Parameter kommen ins Eingangsformat, geliefert wird PCM.
        MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC,
                (int) sampleRate, channels);
        format.setInteger(MediaFormat.KEY_BIT_RATE, bitRate);
        format.setInteger(MediaFormat.KEY_AAC_PROFILE,
                MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384);

        MediaCodec encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        encoder.start();

        File out = new File(getContext().getCacheDir(), "audio_encodes");
        if (!out.exists()) out.mkdirs();
        out = new File(out, java.util.UUID.randomUUID() + ".m4a");
        MediaMuxer muxer = new MediaMuxer(out.getAbsolutePath(),
                MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

        boolean inputDone = false, outputDone = false;
        int muxerTrack = -1;
        long framesSent = 0;
        long remaining = dataBytes;
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        pcm.seek(dataOffset);
        try {
            while (!outputDone) {
                if (!inputDone) {
                    int inIdx = encoder.dequeueInputBuffer(10_000);
                    if (inIdx >= 0) {
                        java.nio.ByteBuffer buf = encoder.getInputBuffer(inIdx);
                        buf.clear();
                        int toCopy = (int) Math.min(buf.capacity(), remaining);
                        if (toCopy > 0) {
                            byte[] tmp = new byte[toCopy];
                            pcm.readFully(tmp);
                            buf.put(tmp);
                        }
                        remaining -= toCopy;
                        boolean last = remaining <= 0;
                        long pts = (framesSent * 1_000_000L) / sampleRate;
                        encoder.queueInputBuffer(inIdx, 0, toCopy, pts,
                                last ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0);
                        framesSent += toCopy / (channels * 2L);
                        if (last) inputDone = true;
                    }
                }
                int outIdx = encoder.dequeueOutputBuffer(info, 10_000);
                if (outIdx >= 0) {
                    boolean codecConfig = (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0;
                    if (!codecConfig && info.size > 0) {
                        if (muxerTrack < 0) {
                            muxerTrack = muxer.addTrack(encoder.getOutputFormat());
                            muxer.start();
                        }
                        java.nio.ByteBuffer buf = encoder.getOutputBuffer(outIdx);
                        buf.position(info.offset);
                        buf.limit(info.offset + info.size);
                        muxer.writeSampleData(muxerTrack, buf, info);
                    }
                    encoder.releaseOutputBuffer(outIdx, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                } else if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (muxerTrack < 0) {
                        muxerTrack = muxer.addTrack(encoder.getOutputFormat());
                        muxer.start();
                    }
                }
            }
        } finally {
            try { encoder.stop(); } catch (Exception ignore) {}
            encoder.release();
            if (muxerTrack >= 0) {
                try { muxer.stop(); } catch (Exception ignore) {}
            }
            muxer.release();
        }
        return out;
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

    /* Build-Marke direkt aus dem Paket, damit die Anzeige in der App nie gegen
       versionName/versionCode in android/app/build.gradle driften kann. */
    @PluginMethod
    public void appInfo(PluginCall call) {
        JSObject o = new JSObject();
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            o.put("versionName", info.versionName);
            // getLongVersionCode erst ab API 28 – darunter liegt der Code in info.versionCode.
            o.put("versionCode", android.os.Build.VERSION.SDK_INT >= 28
                ? info.getLongVersionCode() : info.versionCode);
        } catch (Exception e) {
            call.reject("App-Version konnte nicht gelesen werden: " + e.getMessage());
            return;
        }
        call.resolve(o);
    }
}
