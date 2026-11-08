package com.burak.jarvis;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONObject;

import java.util.Iterator;

/** Konum hatırlatmalarını saklar ve Google Play Services geofence olarak kaydeder. */
public class GeoStore {

    interface Err { void on(String message); }

    private static final String PREF = "jarvis_geo";

    static void put(Context c, String id, double lat, double lng, float radius, String text, String action) {
        try {
            JSONObject o = new JSONObject();
            o.put("lat", lat);
            o.put("lng", lng);
            o.put("radius", (double) radius);
            o.put("text", text);
            if (action != null) o.put("action", action);
            c.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(id, o.toString()).apply();
        } catch (Exception ignored) {}
    }

    static void remove(Context c, String id) {
        c.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().remove(id).apply();
    }

    static String text(Context c, String id) {
        try {
            String s = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(id, null);
            return s == null ? null : new JSONObject(s).optString("text", null);
        } catch (Exception e) { return null; }
    }

    static String action(Context c, String id) {
        try {
            String s = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(id, null);
            return s == null ? null : new JSONObject(s).optString("action", null);
        } catch (Exception e) { return null; }
    }

    static PendingIntent pending(Context c) {
        Intent i = new Intent(c, GeofenceReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(c, 77, i, flags);
    }

    @SuppressLint("MissingPermission")
    static void register(Context c, String id, double lat, double lng, float radius, Runnable ok, Err err) {
        try {
            Geofence g = new Geofence.Builder()
                .setRequestId(id)
                .setCircularRegion(lat, lng, radius)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
                .build();
            GeofencingRequest req = new GeofencingRequest.Builder().setInitialTrigger(0).addGeofence(g).build();
            LocationServices.getGeofencingClient(c).addGeofences(req, pending(c))
                .addOnSuccessListener(v -> { if (ok != null) ok.run(); })
                .addOnFailureListener(e -> { if (err != null) err.on("Konum hatırlatması kurulamadı: " + e.getMessage()); });
        } catch (Exception e) {
            if (err != null) err.on(e.getMessage());
        }
    }

    /** Telefon yeniden başladığında tüm konum hatırlatmalarını geri yükler. */
    static void restoreAll(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        for (String id : sp.getAll().keySet()) {
            try {
                JSONObject o = new JSONObject(sp.getString(id, "{}"));
                register(c, id, o.getDouble("lat"), o.getDouble("lng"), (float) o.getDouble("radius"), null, null);
            } catch (Exception ignored) {}
        }
    }
}
