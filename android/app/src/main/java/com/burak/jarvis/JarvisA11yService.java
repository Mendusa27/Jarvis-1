package com.burak.jarvis;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Base64;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.ByteArrayOutputStream;
import java.util.ArrayDeque;

/**
 * Faz 2 — Ekran ajanı. Burak'ın açıkça etkinleştirdiği erişilebilirlik servisi:
 * ekrandaki yazıları okur, düğmelere dokunur, yazı alanına yazar, ekran görüntüsü alır.
 * Her dokunma/yazma JARVIS içinde ekranda onaydan sonra çalışır.
 */
public class JarvisA11yService extends AccessibilityService {

    public static volatile JarvisA11yService instance;

    public interface ShotCallback { void done(String base64Jpeg, String error); }

    static boolean isEnabled(Context c) {
        String enabled = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        String me = new ComponentName(c, JarvisA11yService.class).flattenToString();
        TextUtils.SimpleStringSplitter sp = new TextUtils.SimpleStringSplitter(':');
        sp.setString(enabled);
        while (sp.hasNext()) if (sp.next().equalsIgnoreCase(me)) return true;
        return false;
    }

    @Override protected void onServiceConnected() { super.onServiceConnected(); instance = this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) {}
    @Override public void onInterrupt() {}
    @Override public void onDestroy() { instance = null; super.onDestroy(); }

    /* ---------- okuma ---------- */
    String currentPackage() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        return root != null && root.getPackageName() != null ? root.getPackageName().toString() : "";
    }

    String screenText() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "";
        StringBuilder sb = new StringBuilder();
        ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
        q.add(root);
        int guard = 0;
        while (!q.isEmpty() && sb.length() < 6000 && guard++ < 3000) {
            AccessibilityNodeInfo n = q.poll();
            if (n == null) continue;
            CharSequence t = n.getText();
            CharSequence d = n.getContentDescription();
            if (t != null && t.length() > 0) sb.append(t).append('\n');
            else if (d != null && d.length() > 0 && n.isClickable()) sb.append('[').append(d).append("]\n");
            for (int i = 0; i < n.getChildCount(); i++) q.add(n.getChild(i));
        }
        return sb.toString();
    }

    /* ---------- dokunma ---------- */
    private static boolean matches(AccessibilityNodeInfo n, String[] wants, boolean exact) {
        String t = n.getText() != null ? JarvisPlugin.norm(n.getText().toString()) : "";
        String d = n.getContentDescription() != null ? JarvisPlugin.norm(n.getContentDescription().toString()) : "";
        for (String w : wants) {
            if (w.isEmpty()) continue;
            if (exact ? (t.equals(w) || d.equals(w)) : (t.contains(w) || d.contains(w))) return true;
        }
        return false;
    }

    private static boolean clickNode(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo c = n;
        for (int i = 0; i < 6 && c != null; i++) {
            if (c.isClickable() && c.isEnabled()) return c.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            c = c.getParent();
        }
        return false;
    }

    boolean click(String query, String pkg) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        if (pkg != null && !pkg.isEmpty() && root.getPackageName() != null && !root.getPackageName().toString().startsWith(pkg)) return false;
        String[] wants = query.split("\\|");
        for (int i = 0; i < wants.length; i++) wants[i] = JarvisPlugin.norm(wants[i]);
        for (boolean exact : new boolean[] { true, false }) {
            ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
            q.add(root);
            int guard = 0;
            while (!q.isEmpty() && guard++ < 4000) {
                AccessibilityNodeInfo n = q.poll();
                if (n == null) continue;
                if (n.isVisibleToUser() && matches(n, wants, exact) && clickNode(n)) return true;
                for (int i = 0; i < n.getChildCount(); i++) q.add(n.getChild(i));
            }
        }
        return false;
    }

    boolean type(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (target == null || !target.isEditable()) {
            ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
            q.add(root);
            int guard = 0;
            while (!q.isEmpty() && guard++ < 3000) {
                AccessibilityNodeInfo n = q.poll();
                if (n == null) continue;
                if (n.isEditable() && n.isVisibleToUser()) { target = n; break; }
                for (int i = 0; i < n.getChildCount(); i++) q.add(n.getChild(i));
            }
        }
        if (target == null) return false;
        target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }


    /* ---------- uygulama içinde arama (v3.1) ---------- */
    private static String vid(AccessibilityNodeInfo n) { CharSequence v = n.getViewIdResourceName(); return v == null ? "" : v.toString().toLowerCase(java.util.Locale.ROOT); }

    boolean clickSearch() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        String[] words = { "ara", "arama", "search", "ara…", "ara...", "aramak", "bul" };
        AccessibilityNodeInfo best = null; int bestScore = 0;
        ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
        q.add(root);
        int guard = 0;
        while (!q.isEmpty() && guard++ < 5000) {
            AccessibilityNodeInfo n = q.poll();
            if (n == null) continue;
            if (n.isVisibleToUser()) {
                String id = vid(n);
                String t = n.getText() != null ? JarvisPlugin.norm(n.getText().toString()) : "";
                String d = n.getContentDescription() != null ? JarvisPlugin.norm(n.getContentDescription().toString()) : "";
                String h = (Build.VERSION.SDK_INT >= 26 && n.getHintText() != null) ? JarvisPlugin.norm(n.getHintText().toString()) : "";
                int sc = 0;
                if (n.isEditable() && (id.contains("search") || h.contains("ara") || h.contains("search"))) sc = 5;
                else if (id.contains("search")) sc = 4;
                else for (String w : words) { if (d.equals(w) || t.equals(w)) { sc = 3; break; } if (d.startsWith(w + " ") || h.startsWith(w)) sc = Math.max(sc, 2); }
                if (sc > bestScore) { bestScore = sc; best = n; }
            }
            for (int i = 0; i < n.getChildCount(); i++) q.add(n.getChild(i));
        }
        if (best == null) return false;
        if (best.isEditable()) { best.performAction(AccessibilityNodeInfo.ACTION_FOCUS); return best.performAction(AccessibilityNodeInfo.ACTION_CLICK) || true; }
        return clickNode(best);
    }

    boolean imeEnter() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo f = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (f != null && Build.VERSION.SDK_INT >= 30) {
            if (f.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId())) return true;
        }
        // yedek: görünür "Ara/Search/Git" düğmesine bas
        return click("ara|search|git|go|bul", null);
    }

    boolean global(String action) {
        switch (action) {
            case "geri": return performGlobalAction(GLOBAL_ACTION_BACK);
            case "ana_ekran": return performGlobalAction(GLOBAL_ACTION_HOME);
            case "son_uygulamalar": return performGlobalAction(GLOBAL_ACTION_RECENTS);
            case "bildirimler": return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            case "asagi_kaydir":
            case "yukari_kaydir": {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root == null) return false;
                ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
                q.add(root);
                int guard = 0;
                while (!q.isEmpty() && guard++ < 3000) {
                    AccessibilityNodeInfo n = q.poll();
                    if (n == null) continue;
                    if (n.isScrollable() && n.isVisibleToUser()) {
                        return n.performAction(action.equals("asagi_kaydir")
                            ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
                    }
                    for (int i = 0; i < n.getChildCount(); i++) q.add(n.getChild(i));
                }
                return false;
            }
            default: return false;
        }
    }

    /* ---------- ekran görüntüsü (Android 11+) ---------- */
    void screenshot(ShotCallback cb) {
        if (Build.VERSION.SDK_INT < 30) { cb.done(null, "Ekran görüntüsü Android 11+ gerektirir"); return; }
        takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
            @Override
            public void onSuccess(ScreenshotResult result) {
                try {
                    Bitmap hw = Bitmap.wrapHardwareBuffer(result.getHardwareBuffer(), result.getColorSpace());
                    if (hw == null) { cb.done(null, "Görüntü alınamadı"); return; }
                    Bitmap sw = hw.copy(Bitmap.Config.ARGB_8888, false);
                    result.getHardwareBuffer().close();
                    float k = Math.min(1f, 1280f / Math.max(sw.getWidth(), sw.getHeight()));
                    Bitmap sc = k < 1f ? Bitmap.createScaledBitmap(sw, Math.round(sw.getWidth() * k), Math.round(sw.getHeight() * k), true) : sw;
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    sc.compress(Bitmap.CompressFormat.JPEG, 80, bos);
                    cb.done(Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP), null);
                } catch (Exception e) {
                    cb.done(null, e.getMessage());
                }
            }

            @Override
            public void onFailure(int errorCode) { cb.done(null, "Ekran görüntüsü hatası " + errorCode); }
        });
    }

}
