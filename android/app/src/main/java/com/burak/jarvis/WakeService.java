package com.burak.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.view.KeyEvent;

import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * "Hey Jarvis" uyandırma servisi.
 * Cihaz içinde, internetsiz çalışan Vosk (açık kaynak, ücretsiz) ile yalnızca "jarvis" kelimesini dinler.
 * Kelime duyulunca mikrofonu bırakır, JARVIS'i açar; uygulama işini bitirince RESUME ile tekrar dinler.
 */
public class WakeService extends Service implements RecognitionListener {

    public static final String ACTION_START = "jarvis.wake.START";
    public static final String ACTION_STOP = "jarvis.wake.STOP";
    public static final String ACTION_PAUSE = "jarvis.wake.PAUSE";
    public static final String ACTION_RESUME = "jarvis.wake.RESUME";
    public static final String ACTION_REFRESH = "jarvis.wake.REFRESH";

    static final String CHANNEL = "jarvis_wake";
    static final String CHANNEL_HIT = "jarvis_wake_hit";
    static final int NOTIF_ID = 4201;
    static final int NOTIF_HIT_ID = 4202;
    static final String MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";
    static final String MODEL_DIR = "vosk-en";
    static final String GRAMMAR = "[\"hey jarvis\", \"jarvis\", \"okay jarvis\", \"[unk]\"]";

    public interface StatusListener { void onStatus(String status, int progress, String error); }

    public static volatile StatusListener statusListener;
    public static volatile boolean running = false;
    public static volatile String status = "off";
    public static volatile int progress = 0;
    public static volatile String lastError = null;
    /** Kalibrasyon için paylaşılan model */
    public static volatile Model sharedModel = null;

    public interface SampleCallback { void done(String text, String error); }

    private MediaSessionCompat session;

    private Model model;
    private SpeechService speech;
    private Recognizer recognizer;
    private boolean paused = false;
    private volatile boolean loading = false;
    private long lastHit = 0;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable autoResume = this::resumeListening;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null ? intent.getAction() : ACTION_START;
        switch (action) {
            case ACTION_STOP:
                shutdown();
                return START_NOT_STICKY;
            case ACTION_PAUSE:
                pauseListening();
                return START_STICKY;
            case ACTION_RESUME:
                resumeListening();
                return START_STICKY;
            default:
                try {
                    goForeground();
                } catch (Exception e) {
                    // Android 14+: mikrofon servisi arka planda başlatılamaz (ör. sistem yeniden başlattığında)
                    running = false;
                    status = "off";
                    stopSelf();
                    return START_NOT_STICKY;
                }
                if (!wakeOn() && !headsetOn()) { shutdown(); return START_NOT_STICKY; }
                if (!running) {
                    running = true;
                    if (wakeOn()) new Thread(this::prepareModel, "jarvis-model").start();
                    else setStatus("headset", 100, null);
                } else if (wakeOn() && model == null && !loading) {
                    new Thread(this::prepareModel, "jarvis-model").start();
                } else if (paused) resumeListening();
                applyHeadset();
                return START_STICKY;
            case ACTION_REFRESH:
                applyHeadset();
                if (!wakeOn() && speech != null) pauseListening();
                if (!wakeOn() && !headsetOn()) { shutdown(); return START_NOT_STICKY; }
                return START_STICKY;
        }
    }

    private void setStatus(String s, int p, String err) {
        status = s;
        progress = p;
        lastError = err;
        StatusListener l = statusListener;
        if (l != null) main.post(() -> l.onStatus(s, p, err));
        if (running) updateNotification();
    }

    /* ---------- bildirim ---------- */
    private void channels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Hey Jarvis dinleme", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_HIT) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_HIT, "Jarvis çağrısı", NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
    }

    private PendingIntent openApp(String action, int req) {
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        if (action != null) i.putExtra(JarvisPlugin.EXTRA_ACTION, action);
        return PendingIntent.getActivity(this, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        String text;
        switch (status) {
            case "downloading": text = "Ses modeli indiriliyor… %" + progress; break;
            case "loading": text = "Hazırlanıyor…"; break;
            case "listening": text = "\"Hey Jarvis\" demen yeterli"; break;
            case "paused": text = "Seninle konuşuyor…"; break;
            case "error": text = "Hata: " + lastError; break;
            case "headset": text = "Kulaklık tuşuna bas, dinleyeyim"; break;
            default: text = "Başlatılıyor…";
        }
        Intent stop = new Intent(this, WakeService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 9, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("JARVIS dinlemede")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openApp("listen", 7))
            .addAction(0, "Konuş", openApp("listen", 8))
            .addAction(0, "Kapat", stopPi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void goForeground() {
        channels();
        int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type);
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(NOTIF_ID, buildNotification()); } catch (Exception ignored) {}
    }

    /* ---------- model ---------- */
    private File modelRoot(File dir) {
        if (new File(dir, "am").isDirectory() || new File(dir, "conf").isDirectory()) return dir;
        File[] kids = dir.listFiles();
        if (kids != null) for (File k : kids) {
            if (k.isDirectory() && (new File(k, "am").isDirectory() || new File(k, "conf").isDirectory())) return k;
        }
        return null;
    }

    private void prepareModel() {
        loading = true;
        try {
            File dir = new File(getFilesDir(), MODEL_DIR);
            File root = dir.isDirectory() ? modelRoot(dir) : null;
            if (root == null) {
                setStatus("downloading", 0, null);
                download(dir);
                root = modelRoot(dir);
                if (root == null) throw new Exception("Model dosyası bozuk");
            }
            if (!running) return;
            setStatus("loading", 100, null);
            model = new Model(root.getAbsolutePath());
            sharedModel = model;
            main.post(this::resumeListening);
        } catch (Throwable e) {
            setStatus("error", 0, e.getMessage() != null ? e.getMessage() : e.toString());
        } finally {
            loading = false;
        }
    }

    private void download(File dir) throws Exception {
        File tmp = new File(getCacheDir(), "vosk.zip");
        HttpURLConnection c = (HttpURLConnection) new URL(MODEL_URL).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        long total = c.getContentLengthLong();
        try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream out = new FileOutputStream(tmp)) {
            byte[] buf = new byte[64 * 1024];
            long done = 0;
            int n, lastP = -1;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    int p = (int) (done * 100 / total);
                    if (p != lastP) { lastP = p; setStatus("downloading", p, null); }
                }
            }
        } finally { c.disconnect(); }
        deleteRec(dir);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        String base = dir.getCanonicalPath() + File.separator;
        try (ZipInputStream zin = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(tmp)))) {
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = zin.getNextEntry()) != null) {
                File f = new File(dir, e.getName());
                if (!f.getCanonicalPath().startsWith(base)) continue; // zip slip koruması
                if (e.isDirectory()) { f.mkdirs(); continue; }
                File parent = f.getParentFile();
                if (parent != null) parent.mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.delete();
    }

    private void deleteRec(File f) {
        if (!f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRec(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /* ---------- dinleme ---------- */
    private void resumeListening() {
        main.removeCallbacks(autoResume);
        if (!running || model == null || !wakeOn()) { if (running && !wakeOn() && headsetOn()) setStatus("headset", 100, null); return; }
        if (speech != null) return;
        try {
            closeRecognizer();
            recognizer = new Recognizer(model, 16000.0f, grammar());
            speech = new SpeechService(recognizer, 16000.0f);
            speech.startListening(this);
            paused = false;
            setStatus("listening", 100, null);
        } catch (Throwable e) {
            speech = null;
            setStatus("error", 0, "Mikrofon açılamadı: " + e.getMessage());
            main.postDelayed(autoResume, 15000);
        }
    }

    private void pauseListening() {
        main.removeCallbacks(autoResume);
        if (speech != null) {
            try { speech.stop(); speech.shutdown(); } catch (Throwable ignored) {}
            speech = null;
        }
        closeRecognizer();
        paused = true;
        if (running) setStatus("paused", 100, null);
        // Uygulama haber vermeyi unutursa 90 sn sonra kendiliğinden dinlemeye dön
        main.postDelayed(autoResume, 90000);
    }

    private void closeRecognizer() {
        if (recognizer != null) { try { recognizer.close(); } catch (Throwable ignored) {} recognizer = null; }
    }

    private void onHotword() {
        long now = System.currentTimeMillis();
        if (now - lastHit < 3000) return;
        lastHit = now;
        pauseListening();
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        i.putExtra(JarvisPlugin.EXTRA_ACTION, "wake");
        boolean started = false;
        if (Settings.canDrawOverlays(this)) {
            try { startActivity(i); started = true; } catch (Exception ignored) {}
        }
        // Yedek: tam ekran bildirim (kilit ekranında uygulamayı açar)
        PendingIntent pi = openApp("wake", 11);
        Notification n = new NotificationCompat.Builder(this, CHANNEL_HIT)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Efendim?")
            .setContentText("JARVIS dinliyor — dokun")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(20000)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build();
        if (!started) {
            try { ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIF_HIT_ID, n); } catch (Exception ignored) {}
        }
    }

    private List<String> words = new ArrayList<>();

    private boolean hasJarvis(String json, String key) {
        try {
            String t = " " + new JSONObject(json).optString(key, "") + " ";
            if (t.contains("jarvis")) return true;
            for (String w : words) if (t.contains(" " + w + " ")) return true;
            return false;
        } catch (Exception e) { return false; }
    }

    @Override public void onPartialResult(String hypothesis) { if (hasJarvis(hypothesis, "partial")) main.post(this::onHotword); }
    @Override public void onResult(String hypothesis) { if (hasJarvis(hypothesis, "text")) main.post(this::onHotword); }
    @Override public void onFinalResult(String hypothesis) { if (hasJarvis(hypothesis, "text")) main.post(this::onHotword); }

    /* ---------- ayarlar ---------- */
    private SharedPreferences prefs() { return getSharedPreferences("jarvis", Context.MODE_PRIVATE); }
    private boolean wakeOn() { return prefs().getBoolean("wake", false); }
    private boolean headsetOn() { return prefs().getBoolean("headset", false); }

    static List<String> customWords(Context c) {
        List<String> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(c.getSharedPreferences("jarvis", Context.MODE_PRIVATE).getString("wakeWords", "[]"));
            for (int i = 0; i < a.length(); i++) {
                String w = a.optString(i, "").trim().toLowerCase(java.util.Locale.ROOT);
                if (!w.isEmpty() && w.matches("[a-z']+")) out.add(w);
            }
        } catch (Exception ignored) {}
        return out;
    }

    private String grammar() {
        words = customWords(this);
        JSONArray g = new JSONArray();
        g.put("hey jarvis"); g.put("jarvis"); g.put("okay jarvis");
        for (String w : words) { g.put(w); g.put("hey " + w); }
        g.put("[unk]");
        return g.toString();
    }

    /** Kalibrasyon: kısıtsız dinleyip ne duyduğunu döndürür. */
    static void sample(int ms, SampleCallback cb) {
        Model m = sharedModel;
        if (m == null) { cb.done(null, "Model hazır değil"); return; }
        Handler h = new Handler(Looper.getMainLooper());
        final StringBuilder heard = new StringBuilder();
        try {
            final Recognizer rec = new Recognizer(m, 16000.0f);
            final SpeechService ss = new SpeechService(rec, 16000.0f);
            RecognitionListener l = new RecognitionListener() {
                private void add(String json, String key) {
                    try { String t = new JSONObject(json).optString(key, ""); if (!t.isEmpty()) heard.append(t).append(' '); } catch (Exception ignored) {}
                }
                @Override public void onPartialResult(String hypothesis) {}
                @Override public void onResult(String hypothesis) { add(hypothesis, "text"); }
                @Override public void onFinalResult(String hypothesis) { add(hypothesis, "text"); }
                @Override public void onError(Exception exception) {}
                @Override public void onTimeout() {}
            };
            ss.startListening(l);
            h.postDelayed(() -> {
                try { ss.stop(); ss.shutdown(); } catch (Throwable ignored) {}
                h.postDelayed(() -> {
                    try { rec.close(); } catch (Throwable ignored) {}
                    cb.done(heard.toString().trim(), null);
                }, 400);
            }, ms);
        } catch (Throwable e) {
            cb.done(null, "Kalibrasyon başlatılamadı: " + e.getMessage());
        }
    }

    /* ---------- kulaklık tuşu ---------- */
    private void applyHeadset() {
        if (headsetOn()) {
            if (session != null) return;
            session = new MediaSessionCompat(this, "JarvisHeadset");
            session.setCallback(new MediaSessionCompat.Callback() {
                @Override
                public boolean onMediaButtonEvent(Intent mediaButtonEvent) {
                    @SuppressWarnings("deprecation")
                    KeyEvent ke = mediaButtonEvent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                    if (ke != null && ke.getAction() == KeyEvent.ACTION_DOWN && ke.getRepeatCount() == 0) {
                        int k = ke.getKeyCode();
                        if (k == KeyEvent.KEYCODE_HEADSETHOOK || k == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || k == KeyEvent.KEYCODE_MEDIA_PLAY || k == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                            main.post(WakeService.this::onHotword);
                            return true;
                        }
                    }
                    return super.onMediaButtonEvent(mediaButtonEvent);
                }
                @Override public void onPlay() { main.post(WakeService.this::onHotword); }
                @Override public void onPause() { main.post(WakeService.this::onHotword); }
            });
            session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE)
                .setState(PlaybackStateCompat.STATE_PAUSED, 0, 1f)
                .build());
            session.setActive(true);
            playSilence();
        } else if (session != null) {
            try { session.setActive(false); session.release(); } catch (Throwable ignored) {}
            session = null;
        }
    }

    /** Android medya tuşlarını en son ses çalan oturuma yollar: kısa bir sessizlik çalarak o oturum biz oluruz. */
    private void playSilence() {
        try {
            int rate = 16000, len = rate / 4;
            AudioTrack t = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(len * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build();
            t.write(new short[len], 0, len);
            t.play();
            main.postDelayed(t::release, 600);
        } catch (Throwable ignored) {}
    }
    @Override public void onError(Exception exception) {
        main.post(() -> {
            speech = null;
            setStatus("error", 0, exception.getMessage());
            main.postDelayed(autoResume, 10000);
        });
    }
    @Override public void onTimeout() { main.post(() -> { speech = null; resumeListening(); }); }

    private void shutdown() {
        running = false;
        if (session != null) { try { session.setActive(false); session.release(); } catch (Throwable ignored) {} session = null; }
        sharedModel = null;
        main.removeCallbacks(autoResume);
        if (speech != null) { try { speech.stop(); speech.shutdown(); } catch (Throwable ignored) {} speech = null; }
        closeRecognizer();
        if (model != null) { try { model.close(); } catch (Throwable ignored) {} model = null; }
        setStatus("off", 0, null);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        sharedModel = null;
        if (session != null) { try { session.release(); } catch (Throwable ignored) {} session = null; }
        if (speech != null) { try { speech.shutdown(); } catch (Throwable ignored) {} speech = null; }
        status = "off";
        super.onDestroy();
    }
}
