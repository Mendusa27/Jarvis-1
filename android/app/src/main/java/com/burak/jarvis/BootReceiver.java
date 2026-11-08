package com.burak.jarvis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Telefon açılınca konum hatırlatmalarını geri yükler.
 *  (Zamanlı hatırlatmaları LocalNotifications eklentisi kendisi geri yükler.
 *   Android 14+ mikrofon servisinin açılışta başlamasına izin vermez; Hey Jarvis uygulama açılınca devreye girer.) */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || "android.intent.action.MY_PACKAGE_REPLACED".equals(a)) {
            GeoStore.restoreAll(context);
        }
    }
}
