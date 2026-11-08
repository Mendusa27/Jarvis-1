package com.burak.jarvis;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(
    name = "Jarvis",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "phone", strings = { Manifest.permission.CALL_PHONE }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
    }
)
public class JarvisPlugin extends Plugin {

    public static final String EXTRA_ACTION = "jarvis_action";
    public static final String ALARM_CHANNEL = "jarvis_alarm";
    static final Locale TR = new Locale("tr", "TR");
    private static JarvisPlugin instance;

    private SpeechRecognizer recognizer;
    private PluginCall listenCall;
    private String pendingAction;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        instance = this;
        if (getActivity() != null) pendingAction = takeAction(getActivity().getIntent());
        WakeService.statusListener = (status, progress, error) -> {
            JSObject o = new JSObject();
            o.put("status", status);
            o.put("progress", progress);
            if (error != null) o.put("error", error);
            notifyListeners("wakeStatus", o);
        };
    }

    private String takeAction(Intent i) {
        if (i == null) return null;
        String a = i.getStringExtra(EXTRA_ACTION);
        if (a != null) i.removeExtra(EXTRA_ACTION);
        return a;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String a = takeAction(intent);
        if (a != null) {
            JSObject o = new JSObject();
            o.put("action", a);
            notifyListeners("launch", o, true);
        }
    }

    @PluginMethod
    public void getLaunchAction(PluginCall call) {
        JSObject o = new JSObject();
        o.put("action", pendingAction);
        pendingAction = null;
        call.resolve(o);
    }

    /* ---------------- ses tanıma ---------------- */
    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "listenPermCallback");
            return;
        }
        startRecognizer(call);
    }

    @PermissionCallback
    private void listenPermCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startRecognizer(call);
        else call.reject("Mikrofon izni verilmedi");
    }

    private void startRecognizer(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Bu cihazda ses tanıma servisi yok (Google uygulamasını yükle/güncelle).");
            return;
        }
        if (listenCall != null) listenCall.reject("iptal");
        listenCall = call;
        final String lang = call.getString("lang", "tr-TR");
        main.post(() -> {
            try {
                if (recognizer != null) recognizer.destroy();
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) {}
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {}
                    @Override public void onEvent(int eventType, Bundle params) {}
                    @Override public void onError(int error) {
                        if (listenCall == null) return;
                        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            JSObject o = new JSObject();
                            o.put("text", "");
                            listenCall.resolve(o);
                        } else {
                            listenCall.reject("Ses tanıma hatası " + error);
                        }
                        listenCall = null;
                    }
                    @Override public void onResults(Bundle results) {
                        if (listenCall == null) return;
                        ArrayList<String> r = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        JSObject o = new JSObject();
                        o.put("text", (r != null && !r.isEmpty()) ? r.get(0) : "");
                        listenCall.resolve(o);
                        listenCall = null;
                    }
                    @Override public void onPartialResults(Bundle partial) {
                        ArrayList<String> r = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (r != null && !r.isEmpty()) {
                            JSObject o = new JSObject();
                            o.put("text", r.get(0));
                            notifyListeners("partial", o);
                        }
                    }
                });
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
                i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
                i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L);
                i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
                if (Build.VERSION.SDK_INT >= 34) {
                    // Türkçe konuşurken araya giren İngilizce kelimeler için dil geçişi
                    i.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_SWITCH, RecognizerIntent.LANGUAGE_SWITCH_BALANCED);
                    i.putStringArrayListExtra(RecognizerIntent.EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES, new ArrayList<>(java.util.Arrays.asList("tr-TR", "en-US")));
                }
                recognizer.startListening(i);
            } catch (Exception e) {
                if (listenCall != null) { listenCall.reject("Ses tanıma başlatılamadı: " + e.getMessage()); listenCall = null; }
            }
        });
    }

    @PluginMethod
    public void stopListen(PluginCall call) {
        main.post(() -> { if (recognizer != null) recognizer.stopListening(); });
        call.resolve();
    }

    /* ---------------- rehber + arama ---------------- */
    static String norm(String s) {
        if (s == null) return "";
        String l = s.toLowerCase(TR).replace('ı', 'i');
        l = Normalizer.normalize(l, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return l.trim();
    }

    @PluginMethod
    public void findContact(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermCallback");
            return;
        }
        doFindContact(call);
    }

    @PermissionCallback
    private void contactsPermCallback(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) doFindContact(call);
        else call.reject("Rehber izni verilmedi");
    }

    private void doFindContact(PluginCall call) {
        String q = norm(call.getString("name", ""));
        JSArray exact = new JSArray(), starts = new JSArray(), contains = new JSArray();
        Set<String> seen = new HashSet<>();
        try (Cursor c = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[] { ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER },
                null, null, null)) {
            if (c != null) {
                while (c.moveToNext()) {
                    String name = c.getString(0), number = c.getString(1);
                    if (name == null || number == null) continue;
                    String n = norm(name);
                    String key = n + "|" + number.replaceAll("\\D", "");
                    if (!seen.add(key)) continue;
                    JSObject o = new JSObject();
                    o.put("name", name);
                    o.put("number", number);
                    if (n.equals(q)) exact.put(o);
                    else if (n.startsWith(q)) starts.put(o);
                    else if (n.contains(q) || (q.length() > 2 && q.contains(n))) contains.put(o);
                }
            }
        } catch (Exception e) {
            call.reject("Rehber okunamadı: " + e.getMessage());
            return;
        }
        JSArray all = new JSArray();
        try {
            for (int i = 0; i < exact.length(); i++) all.put(exact.get(i));
            for (int i = 0; i < starts.length(); i++) all.put(starts.get(i));
            for (int i = 0; i < contains.length() && all.length() < 10; i++) all.put(contains.get(i));
        } catch (Exception ignored) {}
        JSObject r = new JSObject();
        r.put("contacts", all);
        call.resolve(r);
    }

    @PluginMethod
    public void call(PluginCall call) {
        if (getPermissionState("phone") != PermissionState.GRANTED) {
            requestPermissionForAlias("phone", call, "phonePermCallback");
            return;
        }
        doCall(call, true);
    }

    @PermissionCallback
    private void phonePermCallback(PluginCall call) {
        doCall(call, getPermissionState("phone") == PermissionState.GRANTED);
    }

    @SuppressLint("MissingPermission")
    private void doCall(PluginCall call, boolean direct) {
        String number = call.getString("number", "");
        Intent i = new Intent(direct ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number)));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            JSObject o = new JSObject();
            o.put("ok", true);
            o.put("direct", direct);
            call.resolve(o);
        } catch (Exception e) {
            call.reject("Arama başlatılamadı: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Bunu açacak uygulama yok");
        }
    }

    /* ---------------- uygulama açma ---------------- */
    @PluginMethod
    public void openApp(PluginCall call) {
        String q = norm(call.getString("name", ""));
        String[][] aliases = {
            { "harita", "maps" }, { "haritalar", "maps" }, { "kamera", "camera" }, { "ayarlar", "settings" },
            { "takvim", "calendar" }, { "saat", "clock" }, { "mesajlar", "messages" }, { "rehber", "contacts" },
            { "galeri", "gallery" }, { "fotograflar", "photos" }, { "hesap makinesi", "calculator" }, { "telefon", "phone" },
            { "insta", "instagram" }, { "wp", "whatsapp" }, { "vatsap", "whatsapp" }, { "yutup", "youtube" }
        };
        String alt = null;
        for (String[] a : aliases) if (q.equals(a[0])) alt = a[1];
        PackageManager pm = getContext().getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(launcher, 0);
        ResolveInfo best = null;
        int bestScore = 0;
        for (ResolveInfo ri : apps) {
            String label = norm(String.valueOf(ri.loadLabel(pm)));
            String pkg = ri.activityInfo.packageName.toLowerCase(Locale.ROOT);
            int s = 0;
            for (String t : alt != null ? new String[] { q, alt } : new String[] { q }) {
                if (t.isEmpty()) continue;
                if (label.equals(t)) s = Math.max(s, 100);
                else if (label.startsWith(t)) s = Math.max(s, 70);
                else if (label.contains(t)) s = Math.max(s, 50);
                else if (pkg.contains(t.replace(" ", ""))) s = Math.max(s, 40);
            }
            if (s > bestScore) { bestScore = s; best = ri; }
        }
        JSObject o = new JSObject();
        if (best == null) {
            o.put("opened", false);
            o.put("hata", "Uygulama bulunamadı");
            call.resolve(o);
            return;
        }
        Intent i = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (i == null) {
            i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            i.setComponent(new ComponentName(best.activityInfo.packageName, best.activityInfo.name));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        o.put("opened", true);
        o.put("label", String.valueOf(best.loadLabel(pm)));
        call.resolve(o);
    }

    /* ---------------- fener / rahatsız etme ---------------- */
    @PluginMethod
    public void torch(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            for (String id : cm.getCameraIdList()) {
                Boolean flash = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(flash)) {
                    cm.setTorchMode(id, on);
                    JSObject o = new JSObject();
                    o.put("ok", true);
                    o.put("on", on);
                    call.resolve(o);
                    return;
                }
            }
            call.reject("Fener bulunamadı");
        } catch (Exception e) {
            call.reject("Fener hatası: " + e.getMessage());
        }
    }

    @PluginMethod
    public void dnd(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        JSObject o = new JSObject();
        if (!nm.isNotificationPolicyAccessGranted()) {
            openSettings(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
            o.put("ok", false);
            o.put("hata", "Rahatsız etme erişimi gerekli; ayarlar açıldı, JARVIS'i etkinleştir.");
            call.resolve(o);
            return;
        }
        nm.setInterruptionFilter(on ? NotificationManager.INTERRUPTION_FILTER_PRIORITY : NotificationManager.INTERRUPTION_FILTER_ALL);
        o.put("ok", true);
        o.put("on", on);
        call.resolve(o);
    }

    /* ---------------- bildirimler ---------------- */
    private boolean notifAccess() {
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
    }

    @PluginMethod
    public void getNotifications(PluginCall call) {
        int limit = call.getInt("limit", 15);
        JSObject r = new JSObject();
        r.put("granted", notifAccess());
        JSArray items = new JSArray();
        try {
            JSONArray all = NotifService.read(getContext());
            for (int i = all.length() - 1; i >= 0 && items.length() < limit; i--) items.put(all.getJSONObject(i));
        } catch (Exception ignored) {}
        r.put("items", items);
        call.resolve(r);
    }

    /* ---------------- izinler ---------------- */
    private boolean has(String p) {
        return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void permissionsStatus(PluginCall call) {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("microphone", has(Manifest.permission.RECORD_AUDIO));
        o.put("contacts", has(Manifest.permission.READ_CONTACTS));
        o.put("phone", has(Manifest.permission.CALL_PHONE));
        o.put("location", has(Manifest.permission.ACCESS_FINE_LOCATION));
        o.put("backgroundLocation", Build.VERSION.SDK_INT < 29 ? has(Manifest.permission.ACCESS_FINE_LOCATION) : has(Manifest.permission.ACCESS_BACKGROUND_LOCATION));
        o.put("notifications", Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS));
        boolean exact = true;
        if (Build.VERSION.SDK_INT >= 31) exact = ((AlarmManager) c.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
        o.put("exactAlarm", exact);
        o.put("notificationAccess", notifAccess());
        o.put("dndAccess", ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).isNotificationPolicyAccessGranted());
        o.put("overlay", Settings.canDrawOverlays(c));
        o.put("battery", ((PowerManager) c.getSystemService(Context.POWER_SERVICE)).isIgnoringBatteryOptimizations(c.getPackageName()));
        o.put("camera", has(Manifest.permission.CAMERA));
        o.put("a11y", JarvisA11yService.isEnabled(c));
        call.resolve(o);
    }

    private void openSettings(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent d = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            d.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(d);
        }
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestPerm(PluginCall call) {
        String name = call.getString("name", "");
        Uri pkg = Uri.parse("package:" + getContext().getPackageName());
        switch (name) {
            case "microphone":
            case "contacts":
            case "phone":
            case "camera":
            case "location":
                requestPermissionForAlias(name, call, "genericPermCallback");
                return;
            case "backgroundLocation":
                if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) { requestPermissionForAlias("location", call, "genericPermCallback"); return; }
                if (Build.VERSION.SDK_INT >= 30) openSettings(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg));
                else { requestPermissionForAlias("backgroundLocation", call, "genericPermCallback"); return; }
                break;
            case "a11y":
                openSettings(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                break;
            case "notificationAccess":
                openSettings(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                break;
            case "dndAccess":
                openSettings(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                break;
            case "overlay":
                openSettings(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg));
                break;
            case "battery":
                openSettings(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg));
                break;
            default:
                openSettings(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg));
        }
        call.resolve();
    }

    @PermissionCallback
    private void genericPermCallback(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void ensureChannel(PluginCall call) {
        createAlarmChannel(getContext());
        call.resolve();
    }

    static void createAlarmChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(ALARM_CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(ALARM_CHANNEL, "Hatırlatıcılar ve alarmlar", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("JARVIS hatırlatmaları");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 400, 200, 400 });
        AudioAttributes aa = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), aa);
        ch.setBypassDnd(true);
        nm.createNotificationChannel(ch);
    }

    /* ---------------- Hey Jarvis ---------------- */
    @PluginMethod
    public void startWake(PluginCall call) {
        getContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE).edit().putBoolean("wake", true).apply();
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "wakePermCallback");
            return;
        }
        doStartWake(call);
    }

    @PermissionCallback
    private void wakePermCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) doStartWake(call);
        else {
            getContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE).edit().putBoolean("wake", false).putBoolean("headset", false).apply();
            JSObject o = new JSObject(); o.put("ok", false); o.put("error", "Mikrofon izni gerekli"); call.resolve(o);
        }
    }

    private void doStartWake(PluginCall call) {
        JSObject o = new JSObject();
        try {
            Intent i = new Intent(getContext(), WakeService.class).setAction(WakeService.ACTION_START);
            ContextCompat.startForegroundService(getContext(), i);
            o.put("ok", true);
        } catch (Exception e) {
            o.put("ok", false);
            o.put("error", e.getMessage());
        }
        call.resolve(o);
    }

    private void wakeCmd(String action) {
        if (!WakeService.running) return;
        try {
            getContext().startService(new Intent(getContext(), WakeService.class).setAction(action));
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void stopWake(PluginCall call) {
        SharedPreferences sp = getContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE);
        sp.edit().putBoolean("wake", false).apply();
        wakeCmd(sp.getBoolean("headset", false) ? WakeService.ACTION_REFRESH : WakeService.ACTION_STOP);
        call.resolve();
    }

    @PluginMethod
    public void pauseWake(PluginCall call) {
        wakeCmd(WakeService.ACTION_PAUSE);
        call.resolve();
    }

    @PluginMethod
    public void resumeWake(PluginCall call) {
        wakeCmd(WakeService.ACTION_RESUME);
        call.resolve();
    }

    @PluginMethod
    public void wakeStatus(PluginCall call) {
        JSObject o = new JSObject();
        o.put("status", WakeService.running ? WakeService.status : "off");
        o.put("progress", WakeService.progress);
        if (WakeService.lastError != null) o.put("error", WakeService.lastError);
        call.resolve(o);
    }

    /* ---------------- widget ---------------- */
    @PluginMethod
    public void updateWidget(PluginCall call) {
        Context c = getContext();
        c.getSharedPreferences("jarvis", Context.MODE_PRIVATE).edit()
            .putString("w1", call.getString("line1", ""))
            .putString("w2", call.getString("line2", ""))
            .apply();
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, JarvisWidget.class));
        for (int id : ids) JarvisWidget.update(c, m, id);
        call.resolve();
    }

    /* ---------------- konum ---------------- */
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getLocation(PluginCall call) {
        if (!has(Manifest.permission.ACCESS_FINE_LOCATION) && !has(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            requestPermissionForAlias("location", call, "locPermCallback");
            return;
        }
        doGetLocation(call);
    }

    @PermissionCallback
    private void locPermCallback(PluginCall call) {
        if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) doGetLocation(call);
        else call.reject("Konum izni verilmedi");
    }

    @SuppressLint("MissingPermission")
    private void doGetLocation(PluginCall call) {
        LocationServices.getFusedLocationProviderClient(getContext())
            .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            .addOnSuccessListener(loc -> {
                if (loc == null) { call.reject("Konum alınamadı (GPS açık mı?)"); return; }
                JSObject o = new JSObject();
                o.put("lat", loc.getLatitude());
                o.put("lng", loc.getLongitude());
                call.resolve(o);
            })
            .addOnFailureListener(e -> call.reject("Konum hatası: " + e.getMessage()));
    }

    @PluginMethod
    public void addGeofence(PluginCall call) {
        JSObject o = new JSObject();
        if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) {
            o.put("ok", false);
            o.put("error", "Konum izni gerekli (Ayarlar → İzinler → Konum)");
            call.resolve(o);
            return;
        }
        if (Build.VERSION.SDK_INT >= 29 && !has(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            o.put("ok", false);
            o.put("error", "Konum iznini 'Her zaman izin ver' yapman gerekiyor (Ayarlar → İzinler → Konum: her zaman).");
            call.resolve(o);
            return;
        }
        String id = call.getString("id");
        double lat = call.getDouble("lat", 0.0), lng = call.getDouble("lng", 0.0);
        float radius = call.getFloat("radius", 300f);
        String text = call.getString("text", "Konum hatırlatması");
        GeoStore.put(getContext(), id, lat, lng, radius, text, call.getString("action", null));
        GeoStore.register(getContext(), id, lat, lng, radius,
            () -> { o.put("ok", true); call.resolve(o); },
            err -> { GeoStore.remove(getContext(), id); o.put("ok", false); o.put("error", err); call.resolve(o); });
    }

    @PluginMethod
    public void removeGeofence(PluginCall call) {
        String id = call.getString("id");
        GeoStore.remove(getContext(), id);
        LocationServices.getGeofencingClient(getContext()).removeGeofences(Collections.singletonList(id));
        call.resolve();
    }

    /* =====================================================================
       FAZ 1 + FAZ 2 — yeni yerel yetenekler
       ===================================================================== */

    /* ---------------- parmak izi / yüz kilidi ---------------- */
    @PluginMethod
    public void authenticate(PluginCall call) {
        final String reason = call.getString("reason", "JARVIS'i aç");
        main.post(() -> {
            JSObject o = new JSObject();
            try {
                int auth = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
                int can = BiometricManager.from(getContext()).canAuthenticate(auth);
                if (can != BiometricManager.BIOMETRIC_SUCCESS) {
                    o.put("ok", false);
                    o.put("error", "Telefonda parmak izi/yüz ya da ekran kilidi tanımlı değil.");
                    call.resolve(o);
                    return;
                }
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("J.A.R.V.I.S.")
                    .setSubtitle(reason)
                    .setAllowedAuthenticators(auth)
                    .build();
                BiometricPrompt bp = new BiometricPrompt((FragmentActivity) getActivity(), ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            JSObject r = new JSObject(); r.put("ok", true); call.resolve(r);
                        }
                        @Override public void onAuthenticationError(int code, CharSequence msg) {
                            JSObject r = new JSObject(); r.put("ok", false); r.put("error", String.valueOf(msg)); call.resolve(r);
                        }
                    });
                bp.authenticate(info);
            } catch (Exception e) {
                o.put("ok", false);
                o.put("error", e.getMessage());
                call.resolve(o);
            }
        });
    }

    /* ---------------- rehberdeki doğum günleri ---------------- */
    @PluginMethod
    public void getBirthdays(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "bdayPermCallback");
            return;
        }
        doBirthdays(call);
    }

    @PermissionCallback
    private void bdayPermCallback(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) doBirthdays(call);
        else call.reject("Rehber izni verilmedi");
    }

    private void doBirthdays(PluginCall call) {
        JSArray items = new JSArray();
        String sel = ContactsContract.Data.MIMETYPE + "=? AND " + ContactsContract.CommonDataKinds.Event.TYPE + "=?";
        String[] args = { ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE, String.valueOf(ContactsContract.CommonDataKinds.Event.TYPE_BIRTHDAY) };
        try (Cursor c = getContext().getContentResolver().query(ContactsContract.Data.CONTENT_URI,
                new String[] { ContactsContract.Data.DISPLAY_NAME, ContactsContract.CommonDataKinds.Event.START_DATE }, sel, args, null)) {
            if (c != null) while (c.moveToNext()) {
                String name = c.getString(0), d = c.getString(1);
                if (name == null || d == null) continue;
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d{1,2})-(\\d{1,2})$").matcher(d.trim());
                if (!m.find()) continue;
                JSObject o = new JSObject();
                o.put("name", name);
                o.put("md", String.format(Locale.ROOT, "%02d-%02d", Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2))));
                items.put(o);
            }
        } catch (Exception e) {
            call.reject("Doğum günleri okunamadı: " + e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("items", items);
        call.resolve(r);
    }

    /* ---------------- video kaydetme (parça parça) ---------------- */
    private java.io.File tmpFile(String name) {
        return new java.io.File(getContext().getCacheDir(), name.replaceAll("[^A-Za-z0-9._-]", "_"));
    }

    @PluginMethod
    public void fileBegin(PluginCall call) {
        java.io.File f = tmpFile(call.getString("name", "kayit.webm"));
        //noinspection ResultOfMethodCallIgnored
        f.delete();
        call.resolve();
    }

    @PluginMethod
    public void fileAppend(PluginCall call) {
        java.io.File f = tmpFile(call.getString("name", "kayit.webm"));
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(f, true)) {
            out.write(android.util.Base64.decode(call.getString("data", ""), android.util.Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("Yazılamadı: " + e.getMessage());
        }
    }

    @PluginMethod
    public void fileSave(PluginCall call) {
        String name = call.getString("name", "dosya.bin");
        String mime = call.getString("mime", "application/octet-stream");
        if (mime.contains(";")) mime = mime.substring(0, mime.indexOf(';'));
        String col = call.getString("collection", "downloads");
        java.io.File f = tmpFile(name);
        try {
            String rel; String envDir;
            if ("pictures".equals(col)) { rel = "Pictures/JARVIS"; envDir = android.os.Environment.DIRECTORY_PICTURES; }
            else if ("movies".equals(col)) { rel = "Movies/JARVIS"; envDir = android.os.Environment.DIRECTORY_MOVIES; }
            else { rel = "Download/JARVIS"; envDir = android.os.Environment.DIRECTORY_DOWNLOADS; }
            Uri uri;
            if (Build.VERSION.SDK_INT >= 29) {
                Uri base;
                if ("pictures".equals(col)) base = android.provider.MediaStore.Images.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY);
                else if ("movies".equals(col)) base = android.provider.MediaStore.Video.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY);
                else base = android.provider.MediaStore.Downloads.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY);
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, rel);
                v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
                android.content.ContentResolver cr = getContext().getContentResolver();
                uri = cr.insert(base, v);
                if (uri == null) throw new Exception("Dosya kaydı oluşturulamadı");
                try (java.io.OutputStream out = cr.openOutputStream(uri); java.io.InputStream in = new java.io.FileInputStream(f)) {
                    if (out == null) throw new Exception("Dosya açılamadı");
                    byte[] buf = new byte[256 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                v.clear();
                v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, v, null, null);
            } else {
                java.io.File dir = new java.io.File(android.os.Environment.getExternalStoragePublicDirectory(envDir), "JARVIS");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                java.io.File dst = new java.io.File(dir, name);
                try (java.io.InputStream in = new java.io.FileInputStream(f); java.io.OutputStream out = new java.io.FileOutputStream(dst)) {
                    byte[] buf = new byte[256 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                android.media.MediaScannerConnection.scanFile(getContext(), new String[] { dst.getAbsolutePath() }, new String[] { mime }, null);
                uri = Uri.fromFile(dst);
            }
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            JSObject o = new JSObject();
            o.put("ok", true);
            o.put("uri", uri.toString());
            o.put("path", rel + "/" + name);
            call.resolve(o);
        } catch (Exception e) {
            call.reject("Kaydedilemedi: " + e.getMessage());
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri", ""));
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(call.getString("mime", "*/*"));
            i.putExtra(Intent.EXTRA_STREAM, uri);
            String text = call.getString("text", null);
            if (text != null) i.putExtra(Intent.EXTRA_TEXT, text);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent ch = Intent.createChooser(i, "Paylaş");
            ch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(ch);
            call.resolve();
        } catch (Exception e) {
            call.reject("Paylaşılamadı: " + e.getMessage());
        }
    }

    @PluginMethod
    public void fileSaveToGallery(PluginCall call) {
        String name = call.getString("name", "kayit.webm");
        String mime = call.getString("mime", "video/webm");
        if (mime.contains(";")) mime = mime.substring(0, mime.indexOf(';'));
        java.io.File f = tmpFile(name);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, name);
                v.put(android.provider.MediaStore.Video.Media.MIME_TYPE, mime);
                v.put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, "Movies/JARVIS");
                v.put(android.provider.MediaStore.Video.Media.IS_PENDING, 1);
                android.content.ContentResolver cr = getContext().getContentResolver();
                Uri uri = cr.insert(android.provider.MediaStore.Video.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) throw new Exception("Galeri kaydı oluşturulamadı");
                try (java.io.OutputStream out = cr.openOutputStream(uri); java.io.InputStream in = new java.io.FileInputStream(f)) {
                    if (out == null) throw new Exception("Galeri dosyası açılamadı");
                    byte[] buf = new byte[256 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                v.clear();
                v.put(android.provider.MediaStore.Video.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
            } else {
                java.io.File dir = new java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_MOVIES), "JARVIS");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                java.io.File dst = new java.io.File(dir, name);
                try (java.io.InputStream in = new java.io.FileInputStream(f); java.io.OutputStream out = new java.io.FileOutputStream(dst)) {
                    byte[] buf = new byte[256 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                android.media.MediaScannerConnection.scanFile(getContext(), new String[] { dst.getAbsolutePath() }, new String[] { mime }, null);
            }
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            JSObject o = new JSObject();
            o.put("ok", true);
            o.put("path", "Movies/JARVIS/" + name);
            call.resolve(o);
        } catch (Exception e) {
            call.reject("Galeriye kaydedilemedi: " + e.getMessage());
        }
    }

    /* ---------------- metin okuma motoru ayarları ---------------- */
    @PluginMethod
    public void openTtsSettings(PluginCall call) {
        openSettings(new Intent("com.android.settings.TTS_SETTINGS"));
        call.resolve();
    }

    /* ---------------- uyandırma kelimesi kalibrasyonu ---------------- */
    @PluginMethod
    public void getWakeWords(PluginCall call) {
        JSObject o = new JSObject();
        try { o.put("words", new JSArray(WakeService.customWords(getContext()))); } catch (Exception e) { o.put("words", new JSArray()); }
        call.resolve(o);
    }

    @PluginMethod
    public void setWakeWords(PluginCall call) {
        JSArray w = call.getArray("words", new JSArray());
        getContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE).edit().putString("wakeWords", w.toString()).apply();
        if (WakeService.running) { wakeCmd(WakeService.ACTION_PAUSE); main.postDelayed(() -> wakeCmd(WakeService.ACTION_RESUME), 500); }
        call.resolve();
    }

    @PluginMethod
    public void setWakeOptions(PluginCall call) {
        SharedPreferences.Editor e = getContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE).edit();
        if (call.hasOption("strict")) e.putBoolean("wakeStrict", Boolean.TRUE.equals(call.getBoolean("strict", true)));
        if (call.hasOption("conf")) e.putFloat("wakeConf", call.getFloat("conf", 0.92f));
        e.apply();
        if (WakeService.running) { wakeCmd(WakeService.ACTION_PAUSE); main.postDelayed(() -> wakeCmd(WakeService.ACTION_RESUME), 500); }
        call.resolve();
    }

    @PluginMethod
    public void wakeSample(PluginCall call) {
        if (WakeService.sharedModel == null) { call.reject("Önce Hey Jarvis'i aç ve modelin yüklenmesini bekle."); return; }
        wakeCmd(WakeService.ACTION_PAUSE);
        final int ms = call.getInt("ms", 3500);
        main.postDelayed(() -> WakeService.sample(ms, (text, err) -> {
            if (err != null) { call.reject(err); return; }
            JSObject o = new JSObject();
            o.put("text", text);
            call.resolve(o);
        }), 500);
    }

    /* ---------------- kulaklık tuşu ---------------- */
    @PluginMethod
    public void setHeadset(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        SharedPreferences sp = getContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE);
        sp.edit().putBoolean("headset", on).apply();
        if (on) {
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                requestPermissionForAlias("microphone", call, "wakePermCallback");
                return;
            }
            doStartWake(call);
        } else {
            if (!sp.getBoolean("wake", false)) wakeCmd(WakeService.ACTION_STOP);
            else wakeCmd(WakeService.ACTION_REFRESH);
            JSObject o = new JSObject(); o.put("ok", true); call.resolve(o);
        }
    }

    /* ---------------- ekran ajanı (erişilebilirlik) ---------------- */
    @PluginMethod
    public void a11yStatus(PluginCall call) {
        JSObject o = new JSObject();
        o.put("enabled", JarvisA11yService.isEnabled(getContext()) && JarvisA11yService.instance != null);
        call.resolve(o);
    }

    /** JARVIS öndeyse kendini arka plana alır ki alttaki uygulama görülsün/kullanılsın. */
    private void hideSelfThen(Runnable r) {
        boolean front = getActivity() != null && getActivity().hasWindowFocus();
        if (front) { getActivity().moveTaskToBack(true); main.postDelayed(r, 750); }
        else main.post(r);
    }

    private void bringBack() {
        Intent i = new Intent(getContext(), MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try { getContext().startActivity(i); } catch (Exception ignored) {}
    }

    @PluginMethod
    public void screenText(PluginCall call) {
        JarvisA11yService s = JarvisA11yService.instance;
        if (s == null) { call.reject("Ekran erişimi kapalı"); return; }
        hideSelfThen(() -> {
            JSObject o = new JSObject();
            o.put("text", s.screenText());
            o.put("app", s.currentPackage());
            bringBack();
            call.resolve(o);
        });
    }

    @PluginMethod
    public void screenshot(PluginCall call) {
        JarvisA11yService s = JarvisA11yService.instance;
        if (s == null) { call.reject("Ekran erişimi kapalı"); return; }
        hideSelfThen(() -> s.screenshot((b64, err) -> {
            bringBack();
            JSObject o = new JSObject();
            if (b64 != null) o.put("data", b64); else o.put("error", err);
            call.resolve(o);
        }));
    }

    @PluginMethod
    public void a11yClick(PluginCall call) {
        JarvisA11yService s = JarvisA11yService.instance;
        if (s == null) { call.reject("Ekran erişimi kapalı"); return; }
        final String text = call.getString("text", ""), pkg = call.getString("pkg", "");
        hideSelfThen(() -> {
            JSObject o = new JSObject();
            o.put("ok", s.click(text, pkg));
            call.resolve(o);
        });
    }

    @PluginMethod
    public void a11yType(PluginCall call) {
        JarvisA11yService s = JarvisA11yService.instance;
        if (s == null) { call.reject("Ekran erişimi kapalı"); return; }
        final String text = call.getString("text", "");
        hideSelfThen(() -> {
            JSObject o = new JSObject();
            o.put("ok", s.type(text));
            call.resolve(o);
        });
    }

    @PluginMethod
    public void a11yGlobal(PluginCall call) {
        JarvisA11yService s = JarvisA11yService.instance;
        if (s == null) { call.reject("Ekran erişimi kapalı"); return; }
        final String action = call.getString("action", "geri");
        hideSelfThen(() -> {
            JSObject o = new JSObject();
            o.put("ok", s.global(action));
            call.resolve(o);
        });
    }

    /* ---------------- v1.3: gerçek alarm ve zamanlayıcı (Saat uygulaması) ---------------- */
    @PluginMethod
    public void setAlarm(PluginCall call) {
        JSObject o = new JSObject();
        try {
            Intent i = new Intent(android.provider.AlarmClock.ACTION_SET_ALARM);
            i.putExtra(android.provider.AlarmClock.EXTRA_HOUR, (int) call.getInt("hour", 7));
            i.putExtra(android.provider.AlarmClock.EXTRA_MINUTES, (int) call.getInt("minute", 0));
            i.putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, call.getString("message", "JARVIS"));
            i.putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true);
            i.putExtra(android.provider.AlarmClock.EXTRA_VIBRATE, true);
            JSArray days = call.getArray("days", new JSArray());
            if (days.length() > 0) {
                ArrayList<Integer> d = new ArrayList<>();
                // JS: 0=Pazar..6=Cumartesi  →  Calendar: 1=Pazar..7=Cumartesi
                for (int k = 0; k < days.length(); k++) d.add(days.getInt(k) + 1);
                i.putExtra(android.provider.AlarmClock.EXTRA_DAYS, d);
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (i.resolveActivity(getContext().getPackageManager()) == null) {
                o.put("ok", false); o.put("error", "Saat uygulaması alarm isteğini kabul etmiyor"); call.resolve(o); return;
            }
            getContext().startActivity(i);
            o.put("ok", true);
        } catch (Exception e) {
            o.put("ok", false); o.put("error", e.getMessage());
        }
        call.resolve(o);
    }

    @PluginMethod
    public void setTimer(PluginCall call) {
        JSObject o = new JSObject();
        try {
            Intent i = new Intent(android.provider.AlarmClock.ACTION_SET_TIMER);
            i.putExtra(android.provider.AlarmClock.EXTRA_LENGTH, Math.max(1, (int) call.getInt("seconds", 60)));
            i.putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, call.getString("message", "JARVIS"));
            i.putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (i.resolveActivity(getContext().getPackageManager()) == null) {
                o.put("ok", false); o.put("error", "Saat uygulaması zamanlayıcıyı kabul etmiyor"); call.resolve(o); return;
            }
            getContext().startActivity(i);
            o.put("ok", true);
        } catch (Exception e) {
            o.put("ok", false); o.put("error", e.getMessage());
        }
        call.resolve(o);
    }

    @PluginMethod
    public void canSetAlarm(PluginCall call) {
        JSObject o = new JSObject();
        Intent i = new Intent(android.provider.AlarmClock.ACTION_SET_ALARM);
        ResolveInfo ri = getContext().getPackageManager().resolveActivity(i, 0);
        o.put("ok", ri != null);
        if (ri != null) o.put("app", String.valueOf(ri.loadLabel(getContext().getPackageManager())));
        call.resolve(o);
    }
}
