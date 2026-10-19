package com.beatclip.app;

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
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.io.File;

/**
 * Hält die Wiedergabe am Leben, wenn die App im Hintergrund ist oder das Display
 * ausgeschaltet wird, und liefert die Standard-Medienleiste (Sperrbildschirm,
 * Benachrichtigung, Bluetooth-/Headset-Tasten).
 *
 * Der Ton selbst kommt aus dem WebView; dieser Dienst stellt sicher, dass der
 * Prozess priorisiert bleibt und Android die Mediensteuerung übernimmt.
 *
 * Wichtig: Der Dienst fordert bewusst KEINEN eigenen AudioFocus an. Chromium
 * hält fuer das &lt;audio&gt;-Element bereits den AudioFocus; ein zweiter
 * Focus-Clients im selben Prozess fuehrt zu einem Focus-Wechsel, den die
 * Wiedergabepipeline mit Stummschalten/Pausen beantwortet (auf MIUI/Xiaomi
 * bricht die Wiedergabe dadurch nach wenigen Sekunden ab). Bei Anruf oder
 * Navigation pausiert/duckt das System die WebView-Wiedergabe selbst; die
 * MediaSession meldet zusätzlich onPlay/onPause an die Web-UI.
 */
public class AudioHoldService extends Service {

    private static final String TAG = "BeatClipMedia";
    public static final String CHANNEL = "beatclip_playback";
    private static final int NOTIF_ID = 4211;

    public static final String ACT_UPDATE = "com.beatclip.app.UPDATE";
    public static final String ACT_STOP = "com.beatclip.app.STOP";
    public static final String ACT_PLAYPAUSE = "com.beatclip.app.PLAYPAUSE";
    public static final String ACT_NEXT = "com.beatclip.app.NEXT";
    public static final String ACT_PREV = "com.beatclip.app.PREV";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_POS = "positionMs";
    public static final String EXTRA_DUR = "durationMs";
    public static final String EXTRA_ART = "artPath";

    /** Callback in die Plugin-Instanz (JS hoert auf "mediaAction"). */
    public interface Listener { void onAction(String action, long positionMs); }
    private static volatile Listener listener;
    public static void setListener(Listener l){ listener = l; }

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private String title = "BeatClip", artist = "";
    private boolean playing = false;
    private long positionMs = 0, durationMs = 0;
    private String artPath = null;
    private Bitmap artBitmap = null;

    /** Cover aus der Cache-Datei laden (klein gehalten, ~320 px). */
    private void loadArt(){
        artBitmap = null;
        if (artPath == null) return;
        try {
            File f = new File(artPath);
            if (!f.isFile()) return;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(artPath, opts);
            int sample = 1;
            while (opts.outWidth / sample > 512) sample *= 2;
            opts.inJustDecodeBounds = false;
            opts.inSampleSize = sample;
            artBitmap = BitmapFactory.decodeFile(artPath, opts);
        } catch (Exception ignored) { }
    }

    /** Aus dem Plugin gestartet: Werte aktualisieren und foreground bleiben. */
    public static void update(Context ctx, String title, String artist, boolean playing,
                              long positionMs, long durationMs){
        update(ctx, title, artist, playing, positionMs, durationMs, null);
    }

    public static void update(Context ctx, String title, String artist, boolean playing,
                              long positionMs, long durationMs, String artPath){
        AudioHoldService s = instance;
        if (s != null){
            // Service laeuft schon: Werte direkt anwenden. Ein erneutes
            // startForegroundService() waere auf Android 12+ aus dem Hintergrund
            // nicht erlaubt (ForegroundServiceStartNotAllowedException) und
            // erhoht nur die Chance, dass OEM-Roms den Dienst beenden.
            s.applyState(title, artist, playing, positionMs, durationMs, artPath);
            return;
        }
        Intent i = new Intent(ctx, AudioHoldService.class).setAction(ACT_UPDATE)
            .putExtra(EXTRA_TITLE, title).putExtra(EXTRA_ARTIST, artist)
            .putExtra(EXTRA_PLAYING, playing).putExtra(EXTRA_POS, positionMs)
            .putExtra(EXTRA_DUR, durationMs);
        if (artPath != null) i.putExtra(EXTRA_ART, artPath);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
    }

    public static void stop(Context ctx){
        AudioHoldService s = instance;
        if (s != null) s.stopGracefully();
        // Service laeuft nicht -> es muss nichts beendet werden; ein Start nur
        // fuer ACT_STOP waere aus dem Hintergrund nicht erlaubt.
    }

    private static volatile boolean running = false;
    private static volatile AudioHoldService instance;
    public static boolean isRunning(){ return running; }

    @Override public void onCreate(){
        super.onCreate();
        running = true;
        instance = this;
        createChannel();
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BeatClip:Playback");
        } catch (Exception ignored) { }
        session = new MediaSession(this, "BeatClipSession");
        session.setCallback(new MediaSession.Callback(){
            @Override public void onPlay(){ emit("play", 0); }
            @Override public void onPause(){ emit("pause", 0); }
            @Override public void onStop(){ emit("stop", 0); stopSelf(); }
            @Override public void onSkipToNext(){ emit("next", 0); }
            @Override public void onSkipToPrevious(){ emit("prev", 0); }
            @Override public void onSeekTo(long pos){ emit("seek", pos); }
        });
        session.setActive(true);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId){
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (ACT_STOP.equals(action)){ stopGracefully(); return START_NOT_STICKY; }
        if (ACT_PLAYPAUSE.equals(action) || ACT_NEXT.equals(action) || ACT_PREV.equals(action)){
            String a = ACT_PLAYPAUSE.equals(action) ? (playing ? "pause" : "play")
                   : ACT_NEXT.equals(action) ? "next" : "prev";
            emit(a, 0);
            return START_STICKY;
        }
        if (intent != null && intent.hasExtra(EXTRA_TITLE)){
            title = intent.getStringExtra(EXTRA_TITLE);
            artist = intent.getStringExtra(EXTRA_ARTIST) == null ? "" : intent.getStringExtra(EXTRA_ARTIST);
            playing = intent.getBooleanExtra(EXTRA_PLAYING, false);
            positionMs = intent.getLongExtra(EXTRA_POS, 0);
            durationMs = intent.getLongExtra(EXTRA_DUR, 0);
            if (intent.hasExtra(EXTRA_ART)){
                artPath = intent.getStringExtra(EXTRA_ART);
                loadArt();
            }
        }
        showPlayback();
        return START_STICKY;
    }

    /** Werte anwenden, ohne das Intent-System zu bemuehen (Service laeuft bereits). */
    void applyState(String t, String a, boolean p, long pos, long dur, String art){
        if (t != null) title = t;
        artist = (a == null) ? "" : a;
        playing = p;
        positionMs = pos;
        durationMs = dur;
        if (art != null){ artPath = art; loadArt(); }
        showPlayback();
    }

    /** Benachrichtigung + MediaSession aktualisieren und Wakelock anpassen. */
    private void showPlayback(){
        promoteToForeground();
        publishSession();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIF_ID, buildNotification());
        updateWakeLock();
    }

    /** Anhalten ohne neues Intent: Benachrichtigung und Wakelock weg, Dienst beenden. */
    void stopGracefully(){
        playing = false;
        updateWakeLock();
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Exception ignored) { }
        stopSelf();
    }

    /**
     * Haelft dem WebView-Media-Thread, auch bei ausgeschaltetem Display zu
     * laufen (MIUI/OEM-Roms drosseln den Prozess sonst).
     */
    private void updateWakeLock(){
        if (wakeLock == null) return;
        try {
            if (playing && !wakeLock.isHeld()) wakeLock.acquire();
            else if (!playing && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) { }
    }

    private void promoteToForeground(){
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 34){
            try{ startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK); }
            catch (Exception e){ Log.w(TAG, "startForeground(type) fehlgeschlagen", e); startForeground(NOTIF_ID, n); }
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void emit(String action, long pos){
        Listener l = listener;
        if (l != null) l.onAction(action, pos);
    }

    private void createChannel(){
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null){
            NotificationChannel ch = new NotificationChannel(
                CHANNEL, "Wiedergabe", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("BeatClip-Wiedergabe laeuft im Hintergrund");
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
    }

    private PendingIntent pi(int requestCode, String action){
        Intent i = new Intent(this, AudioHoldService.class).setAction(action);
        int flag = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getService(this, requestCode, i, flag);
    }

    private Notification buildNotification(){
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_beatclip)
         .setContentTitle(title)
         .setContentText(artist == null || artist.isEmpty() ? "BeatClip" : artist)
         .setContentIntent(openPi)
         .setOngoing(true)
         .setOnlyAlertOnce(true)
         .setVisibility(Notification.VISIBILITY_PUBLIC)
         .addAction(new Notification.Action.Builder(R.drawable.ic_prev, "Zurueck", pi(1, ACT_PREV)).build())
         .addAction(new Notification.Action.Builder(
             playing ? R.drawable.ic_pause : R.drawable.ic_play,
             playing ? "Pause" : "Play", pi(2, ACT_PLAYPAUSE)).build())
         .addAction(new Notification.Action.Builder(R.drawable.ic_next, "Weiter", pi(3, ACT_NEXT)).build())
         .setStyle(new Notification.MediaStyle()
             .setMediaSession(session == null ? null : session.getSessionToken())
             .setShowActionsInCompactView(0, 1, 2));
        if (artBitmap != null) b.setLargeIcon(artBitmap);
        return b.build();
    }

    private void publishSession(){
        if (session == null) return;
        MediaMetadata.Builder md = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist.isEmpty() ? "BeatClip" : artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, Math.max(0, durationMs));
        if (artBitmap != null){
            md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artBitmap);
            md.putBitmap(MediaMetadata.METADATA_KEY_ART, artBitmap);
        }
        session.setMetadata(md.build());

        int state = playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO
                | PlaybackState.ACTION_STOP)
            .setState(state, Math.max(0, positionMs), playing ? 1f : 0f)
            .build());
    }

    /*
     * Kein requestAudioFocus() an dieser Stelle: das WebView halt fuer sein
     * <audio>-Element bereits den AudioFocus. Ein zweiter Focus-Client im
     * selben Prozess veranlasst Chromium, den alten Client abzuloesen und die
     * Wiedergabepipeline zu stummschalten bzw. zu pausieren. Genau das fuehrte
     * dazu, dass der Ton nach wenigen Sekunden (besonders auf MIUI/Xiaomi) weg
     * war. Anrufe und Navigation ducken/pausieren die Wiedergabe weiterhin,
     * weil das WebView selbst der Focus-Inhaber ist.
     */

    @Override public void onDestroy(){
        running = false;
        instance = null;
        playing = false;
        updateWakeLock();
        if (session != null){ session.setActive(false); session.release(); }
        stopForeground(true);
        emit("stop", 0);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent){ return null; }
}
