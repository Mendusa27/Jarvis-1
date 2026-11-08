package com.burak.jarvis;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

/** Gelen bildirimlerin son 60 tanesini cihazda saklar; JARVIS sesli özetler. */
public class NotifService extends NotificationListenerService {

    private static final String PREF = "jarvis_notifs";
    private static final int MAX = 60;
    private static final Object LOCK = new Object();

    static JSONArray read(Context c) {
        synchronized (LOCK) {
            try {
                return new JSONArray(c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString("list", "[]"));
            } catch (Exception e) {
                return new JSONArray();
            }
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            String pkg = sbn.getPackageName();
            if (pkg == null || pkg.equals(getPackageName()) || pkg.equals("android") || pkg.startsWith("com.android.systemui")) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_ONGOING_EVENT) != 0) return;
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle ex = n.extras;
            String title = ex != null ? String.valueOf(ex.getCharSequence(Notification.EXTRA_TITLE, "")) : "";
            CharSequence big = ex != null ? ex.getCharSequence(Notification.EXTRA_BIG_TEXT) : null;
            String text = big != null ? big.toString() : (ex != null ? String.valueOf(ex.getCharSequence(Notification.EXTRA_TEXT, "")) : "");
            if (title.isEmpty() && text.isEmpty()) return;
            if (text.length() > 300) text = text.substring(0, 300) + "…";

            String app = pkg;
            try {
                PackageManager pm = getPackageManager();
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                app = String.valueOf(pm.getApplicationLabel(ai));
            } catch (Exception ignored) {}

            JSONObject o = new JSONObject();
            o.put("app", app);
            o.put("title", title);
            o.put("text", text);
            o.put("time", sbn.getPostTime());

            synchronized (LOCK) {
                SharedPreferences sp = getSharedPreferences(PREF, Context.MODE_PRIVATE);
                JSONArray arr;
                try { arr = new JSONArray(sp.getString("list", "[]")); } catch (Exception e) { arr = new JSONArray(); }
                // aynı mesajın güncellemesini tekrar ekleme
                if (arr.length() > 0) {
                    JSONObject last = arr.getJSONObject(arr.length() - 1);
                    if (last.optString("app").equals(app) && last.optString("title").equals(title) && last.optString("text").equals(text)) return;
                }
                arr.put(o);
                JSONArray trimmed = new JSONArray();
                int start = Math.max(0, arr.length() - MAX);
                for (int i = start; i < arr.length(); i++) trimmed.put(arr.get(i));
                sp.edit().putString("list", trimmed.toString()).apply();
            }
        } catch (Exception ignored) {}
    }
}
