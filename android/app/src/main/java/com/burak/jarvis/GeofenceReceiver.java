package com.burak.jarvis;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

/** Bir konum hatırlatmasının alanına girilince alarm bildirimi gösterir. */
public class GeofenceReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent ev = GeofencingEvent.fromIntent(intent);
        if (ev == null || ev.hasError() || ev.getGeofenceTransition() != Geofence.GEOFENCE_TRANSITION_ENTER) return;
        if (ev.getTriggeringGeofences() == null) return;
        JarvisPlugin.createAlarmChannel(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        for (Geofence g : ev.getTriggeringGeofences()) {
            String text = GeoStore.text(context, g.getRequestId());
            if (text == null) continue;
            Intent open = new Intent(context, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            String act = GeoStore.action(context, g.getRequestId());
            if (act != null && !act.isEmpty()) open.putExtra(JarvisPlugin.EXTRA_ACTION, act);
            PendingIntent pi = PendingIntent.getActivity(context, g.getRequestId().hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            nm.notify(g.getRequestId().hashCode(), new NotificationCompat.Builder(context, JarvisPlugin.ALARM_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_jarvis)
                .setContentTitle("home".equals(g.getRequestId()) ? "🏠 Eve hoş geldin" : "📍 Vardın Burak")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build());
        }
    }
}
