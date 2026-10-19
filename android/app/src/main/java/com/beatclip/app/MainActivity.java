package com.beatclip.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Native Shell fuer BeatClip:
 *  - Audio startet ohne zusaetzliche Gesten und laeuft im Hintergrund weiter
 *  - Die Hardware-Zuruecktaste bedient zuerst die App-Navigation
 *  - Audiodateien aus anderen Apps ("Teilen -> BeatClip") werden entgegengenommen
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_NOTIF = 41;
    /** True, sobald der Benachrichtigungs-Dialog einmal gezeigt wurde. */
    static boolean notifAsked = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BeatClipMediaPlugin.class);
        super.onCreate(savedInstanceState);

        WebSettings ws = getBridge().getWebView().getSettings();
        ws.setMediaPlaybackRequiresUserGesture(false);

        askNotificationPermissionIfNeeded();
        ShareInbox.capture(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ShareInbox.capture(this, intent);
    }

    private void askNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return;
        int granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS);
        if (granted != PackageManager.PERMISSION_GRANTED) {
            notifAsked = true;
            ActivityCompat.requestPermissions(this,
                    new String[]{ Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIF);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results){
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_NOTIF && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED){
            getBridge().getWebView().evaluateJavascript(
                "(function(){ try { window.beatclipPermissionGranted && window.beatclipPermissionGranted(); } catch(e){} return 0; })()",
                null);
        }
    }

    /** Sheet schliessen bzw. eine Ebene zurueck; auf der Wurzelebene normal beenden. */
    @Override
    public void onBackPressed() {
        getBridge().getWebView().evaluateJavascript(
                "(function(){ try { return (window.beatclipBack && window.beatclipBack()) ? '1' : '0'; }" +
                " catch (e) { return '0'; } })()",
                value -> { if (!"1".equals(value)) super.onBackPressed(); });
    }
}
