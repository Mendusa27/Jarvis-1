package com.burak.jarvis;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/** Ana ekran widget'ı: tek dokunuşla konuş, sıradaki hatırlatıcıyı gör. */
public class JarvisWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
    }

    static void update(Context c, AppWidgetManager m, int id) {
        SharedPreferences sp = c.getSharedPreferences("jarvis", Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_jarvis);
        v.setTextViewText(R.id.w_line1, sp.getString("w1", "JARVIS hazır"));
        v.setTextViewText(R.id.w_line2, sp.getString("w2", "Konuşmak için dokun"));
        v.setOnClickPendingIntent(R.id.w_talk, open(c, "listen", 31));
        v.setOnClickPendingIntent(R.id.w_brief, open(c, "brief", 32));
        v.setOnClickPendingIntent(R.id.w_text, open(c, null, 33));
        m.updateAppWidget(id, v);
    }

    private static PendingIntent open(Context c, String action, int req) {
        Intent i = new Intent(c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (action != null) i.putExtra(JarvisPlugin.EXTRA_ACTION, action);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
