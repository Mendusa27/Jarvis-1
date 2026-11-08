# J.A.R.V.I.S. — Burak'ın Kişisel Asistanı

Android uygulaması (Capacitor). Tamamen ücretsiz bileşenlerle çalışır. Aynı arayüz tarayıcıda da açılır (tablet/bilgisayar).

## Neler yapıyor

| Alan | Özellikler |
|---|---|
| **Konuşma** | "Hey Jarvis" ile uyanma (ekran kapalıyken bile), Türkçe ses tanıma, sesli cevap, soru sorunca otomatik dinleme, konuşurken reaktöre dokunup sözünü kesme |
| **Beyin** | Google Gemini (ücretsiz) ya da ileride Claude. 56 araç kullanır, kalıcı hafıza tutar |
| **Hatırlatma** | Uygulama kapalıyken de çalan alarmlar (tek sefer / her gün / hafta içi / haftalık / aylık), konum hatırlatması ("Kadıköy'e varınca…"), 10 dk erteleme |
| **Telefon** | Rehberden arama ("annemi ara"), WhatsApp ve SMS taslağı, uygulama açma, fener, rahatsız etme, gelen bildirimleri sesli özetleme |
| **Plan** | Görevler (proje etiketli), notlar, sabah brifingi ve gün sonu özeti (bildirimle), hava durumu |
| **Hayat** | Harcama takibi ve 30 günlük rapor, alışkanlıklar (seri takibi), odak/pomodoro modu |
| **Kariyer** | Seçme/çekim takibi (bir gün önce akşam 20:00'de ve 2 saat önce hatırlatma), bar vardiyaları (1 saat önce ve bitişte "eve dönüş" hatırlatması), proje durumları, **replik çalışma** (diğer karakterleri JARVIS okur, sıra sana gelince dinler) |
| **Google** | Gmail özeti, Google Takvim okuma ve etkinlik ekleme, telefon/tablet/bilgisayar arasında veri senkronu |
| **Ekran** | Iron Man HUD arayüzü, ana ekran widget'ı (Konuş + Brifing) |

### Faz 1 (bu sürümde)
| Alan | Özellikler |
|---|---|
| **Proaktif** | Yarın yağmur varsa akşamdan uyarı, 3 günden uzun bekleyen görevler, yarınki seçme için replik dürtmesi, bütçe uyarısı, yaklaşan özel günler, takip zamanı gelen başvurular; her pazar 20:00 haftalık rapor |
| **Rutinler** | Hazır: "Vardiyaya çıkıyorum" (sessiz + vardiya bitişine alarm + partnerine "çıktım" taslağı), "Eve geldim", "İyi geceler", "Günaydın". Kendi rutinlerini Plan → Rutin'den ya da sesle oluştur. Ev konumu kaydedilirse eve varınca "Eve geldim" için bildirim gelir |
| **Görme ve ses** | Fotoğraftan kayıt (fiş → harcama, ilan → seçme), sesli not/toplantı kaydı → özet + görevler + hatırlatıcılar, internette güncel arama |
| **Self-tape** | Replik bölümünde 3-2-1 sonra kamera kaydı; diğer karakterleri JARVIS okur, video galeride Movies/JARVIS klasörüne kaydedilir |
| **İş** | KADRO tablosunda arama/sayım, Gmail taslağı (Recast mailleri), casting ilanı ve kiralık ev radarı (her saat tarama, ntfy ile anlık bildirim) |
| **Kolaylık** | Kulaklık tuşuyla konuşma, parmak izi/yüz kilidi, rehberden doğum günleri, bilgisayar/tablet için web paneli (kısayol: Ctrl+K), uyku modu |

### Faz 2 (bu sürümde)
| Alan | Özellikler |
|---|---|
| **Ekran ajanı** | "Ekranımda ne var?" (ekran görüntüsünü yorumlar), ekranda bir düğmeye dokunma, yazı yazma, geri/ana ekran/kaydırma, WhatsApp'ta gönder tuşuna otomatik basma (her işlemden önce onay ister) |
| **Çok adımlı görevler** | "Cumartesi seçmesine hazırla" → takvim, hava, yol süresi, hatırlatıcı, görev ve notları sırayla halleder (tek istekte 12 adıma kadar) |
| **İnternetsiz** | İnternet yokken hatırlatıcı, not, görev, fener, uygulama açma, arama, odak ve rutinler çalışır. Doğal Türkçe ses için Piper (sherpa-onnx) rehberi |
| **Uyandırma** | "Sesime uyarla": 5 tekrarla senin telaffuzunu öğrenir |
| **Bilgisayar ajanı** | Telefondan: uygulama/link aç, dosya bul, dosyayı Gmail taslağına ekle, ekranı kilitle |
| **Akıllı ev** | Home Assistant / IFTTT / Smart Life webhook'ları: "salon ışığını aç" |
| **İstanbul** | Seçme yeri girilince yol süresi hesaplanır ve "çıkma vakti" alarmı kurulur; Google Haritalar'da canlı toplu taşıma tarifi |
| **Para** | Fatura/abonelik takibi (2 gün önce hatırlatma), aylık bütçe ve %80/%100 uyarıları |
| **Kariyer koçu** | Başvuru takibi (durum + 7 gün sonra takip hatırlatması), replik kaydına performans geri bildirimi, haftalık hedefler (pazartesi sıfırlanır, geçmiş tutulur) |

Arama, WhatsApp, takvime ekleme, mail taslağı, ekranda dokunma ve bilgisayar komutları her zaman ekranda **onay** ister.

---

## 1) Ücretsiz Gemini anahtarı (zorunlu, 2 dakika)
1. https://aistudio.google.com adresine Google hesabınla gir.
2. **Get API key → Create API key**. Kart istemez.
3. JARVIS → **Ayarlar → Beyin → Gemini API anahtarı** kısmına yapıştır, sonra **Bağlantıyı test et**.

> Not: Ücretsiz katmanda günlük istek sınırı var ve Google gönderilen içeriği ürünlerini geliştirmek için kullanabilir. Çok özel bilgileri buna göre paylaş.
> Model adı çalışmazsa uygulama sıradaki ücretsiz modele kendisi geçer.

## 2) İlk açılışta izinler
**Ayarlar → İzinler** bölümünde her satırda "İzin ver" düğmesi var:
- **Bildirim** ve **Tam zamanlı alarm**: hatırlatıcıların dakikasında çalması için
- **Mikrofon**: sesli komut
- **Rehber** ve **Telefon**: "annemi ara"
- **Bildirim erişimi**: gelen bildirimleri okuyabilmesi için (açılan ekranda JARVIS'i etkinleştir)
- **Rahatsız etme erişimi**: odak modu
- **Konum** ve **Konum: her zaman**: konum hatırlatmaları
- **Diğer uygulamaların üzerinde**: "Hey Jarvis" deyince ekranı açabilmesi için
- **Pil kısıtlamasız**: Xiaomi, Samsung gibi telefonlarda arka planda kapanmasın diye

## 3) "Hey Jarvis"
Ayarlar → **Hey Jarvis**'i aç. İlk seferde yaklaşık 40 MB'lık açık kaynak ses modeli (Vosk) iner, sonra tamamen internetsiz çalışır. Bildirim çubuğunda "JARVIS dinlemede" yazar.
- "Hey Jarvis" de → JARVIS "Efendim?" der ve dinler.
- Pil kullanır. İstemediğinde bildirimden **Kapat**'a bas.
- Android 14 ve sonrası, telefon yeniden başlayınca mikrofon servisinin kendiliğinden açılmasına izin vermiyor. JARVIS'i bir kez açman yeterli.

## 4) Google bağlantısı (isteğe bağlı: senkron, Gmail, Takvim)
1. https://script.google.com → **Yeni proje**.
2. `apps-script/Code.gs` içeriğini yapıştır. En üstteki `TOKEN` değerini uzun, sana özel bir şifreyle değiştir.
3. Proje ayarlarında saat dilimini **Europe/Istanbul** yap (ya da `appsscript.json` içeriğini kullan).
4. **Dağıt → Yeni dağıtım → Web uygulaması**. Çalıştıran: **Ben**, Erişim: **Herkes**. Çıkan izin ekranlarını onayla.
5. Verilen `…/exec` adresini ve TOKEN'ı JARVIS → **Ayarlar → Google**'a yaz, sonra **Test et**.
6. Tablet ya da bilgisayarda aynı ayarları girince veriler eşitlenir.

Veriler senin Google Drive'ında `jarvis-veri.json` dosyasında durur. Gizli anahtarı kimseyle paylaşma.

## 5) Daha doğal Türkçe ses
Telefon Ayarlar → **Metin okuma çıkışı** → Google Konuşma Hizmetleri → Türkçe ses verilerini indir. Sonra JARVIS → Ayarlar → Ses'ten bir ses seç ve hız/ton ayarla.

## 6) Faz 1–2 kurulumları (isteğe bağlı)
- **Ekran erişimi:** Ayarlar → Güvenlik → Ekran erişimi → Aç → listeden "JARVIS ekran asistanı"nı aç. APK ile kurulduğu için Android 13+ bunu gri gösterebilir. O zaman telefon Ayarlar → Uygulamalar → JARVIS → sağ üst ⋮ → **Kısıtlanmış ayarlara izin ver**, sonra tekrar dene.
- **Parmak izi kilidi / kulaklık tuşu:** Ayarlar → Güvenlik ve kısayollar'dan aç.
- **Ev konumu:** Evdeyken Ayarlar → Kişisel → **Burası evim**.
- **Uyandırmayı sesine uyarla:** Hey Jarvis açıkken Ayarlar → **Kalibre et**.
- **KADRO:** KADRO'nun Google E-Tablo linkindeki `/d/` ile `/edit` arasındaki kimliği Ayarlar → İş bağlantıları'na yapıştır.
- **Radar:** Aynı bölümde kaynak ekle. Gmail için arama (ör. `casting OR seçme OR "oyuncu aranıyor"`), web için ilan sayfası linki ve anahtar kelimeler gir, sonra **Radarı Google'a kaydet**. Anlık bildirim istersen telefona ücretsiz **ntfy** uygulamasını kur, tahmin edilmesi zor bir konu adına abone ol, aynı adı ayara yaz.
- **Apps Script güncellemesi:** Bu sürümde `Code.gs` büyüdü. Yeni halini yapıştırıp **Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm** de. İlk radar kaydında saatlik tarama izni ister.
- **Bilgisayar ajanı:** Bilgisayara Python 3 kur, `pc-agent/jarvis_pc.py` dosyasını çalıştır (Windows'ta `JARVIS-baslat.bat`). İlk açılışta Apps Script URL'si ve TOKEN'ı sorar. Açık kaldığı sürece telefondan komut alır.
- **Akıllı ev:** Ayarlar → Akıllı ev'e cihaz adı ve webhook linki ekle (Home Assistant, IFTTT Webhooks ya da Smart Life + IFTTT).
- **Doğal ses (Piper):** Ayarlar → Doğal Türkçe ses kartındaki 4 adım.

## v1.5: Canlı konuşma, doğal ses, Groq
- **Canlı konuşma (Gemini Live):** "Hey Jarvis" deyince ya da mikrofona basınca gerçek zamanlı sohbet açılır. Anında cevap verir, konuşurken sözünü kesebilirsin. 25 sn sessizlikte kapanır (Ayarlar'dan değişir). Kota dolarsa kendiliğinden normal moda geçer.
- **Akışlı cevap:** Normal modda cevabın ilk cümlesi hazır olur olmaz konuşmaya başlar.
- **Doğal ses:** Gemini'nin insan gibi sesi. Ücretsiz ses kotası dolarsa telefonun sesine geçer.
- **Groq (ücretsiz):** console.groq.com'dan anahtar alıp Ayarlar → Groq'a gir. Ses tanıma Whisper ile çok hızlanır. Gemini kotası dolarsa JARVIS Groq ile çalışmaya devam eder.
- **Hazır brifing:** Apps Script her saat takvim ve mail verisini hazırlar, "Günaydın" deyince beklemeden gelir. Code.gs'i güncelleyip yeni sürüm olarak dağıtman gerekir.
- **Haftalık hafıza özeti:** JARVIS her hafta sohbetlerini özetleyip hatırlar.

### Vivo telefonlar için (önemli)
Vivo, arka plandaki uygulamaları agresif kapatır. JARVIS'in sürekli çalışması için:
1. Ayarlar → Pil → **Arka planda yüksek güç tüketimi** → JARVIS'i aç.
2. Ayarlar → Uygulamalar → **Otomatik başlatma** → JARVIS'i aç.
3. Son uygulamalar ekranında JARVIS'i aşağı çekip **kilitle** (asma kilit simgesi).

## Bilinen sınırlar
- Canlı modda hoparlörden konuşurken JARVIS'in sözünü kesmek için biraz yüksek sesle konuşman gerekir (kendi sesini duymasın diye). Kulaklıkla bu ayarı açabilirsin.
- Kulaklık tuşu, başka bir müzik/podcast uygulaması çalarken o uygulamaya gider.
- "Ekranımda ne var?" için Android 11+ gerekir. Daha eski sürümlerde sadece ekrandaki yazıları okur.
- Radar, otomatik okumayı engelleyen sitelerde (ör. bazı emlak siteleri) sonuç bulamayabilir. Gmail ilan bildirimleri her zaman çalışır.
- Yol süresi trafik payıyla tahmini hesaplanır. Canlı toplu taşıma saatleri için JARVIS Google Haritalar'ı açar.
- İnternetsiz modda yapay zekâ yok. Sadece kalıp komutlar çalışır ("10 dakika sonra … hatırlat", "not al: …", "annemi ara", "Spotify aç").

## Komut örnekleri
- "Yarın 10'da Raw Frame'i aramamı hatırlat"
- "Hafta içi her sabah 9'da su içmeyi hatırlat"
- "Kadıköy'e varınca ekmek almamı hatırlat"
- "Annemi ara" · "Kübra'ya WhatsApp'tan çıktım yaz"
- "Spotify'ı aç" · "Feneri yak" · "45 dakika odak başlat"
- "Son maillerimi özetle" · "Bildirimlerimi oku" · "Bugün takvimimde ne var?"
- "Bugün 250 lira yemeğe verdim" · "Bu ay ne kadar harcadım?"
- "Cuma 14:00'te Netflix dizisi için seçmem var, Nişantaşı"
- "Cumartesi 18:00–02:00 vardiyam var"
- "Galerici'de araç satın alma ekranında kaldım, sırada pazarlık sistemi var"
- "Annemin doğum günü 3 Mart, unutma"
- "Vardiyaya çıkıyorum" · "Eve geldim" · "İyi geceler"
- (fiş fotoğrafıyla) "Bunu harcamalara ekle"
- "Bu akşam Kadıköy'de hangi oyunlar var?" (internet araması)
- "Ekranımda ne var?" · "Gönder'e bas" · "Geri git"
- "Bilgisayarda Premiere'i aç" · "Masaüstündeki CV'yi recasttalent@gmail.com'a taslak olarak ekle"
- "Salon ışığını aç"
- "Netflix aboneliğim her ayın 15'i, 229 lira" · "Aylık bütçem 15 bin lira"
- "Ece Casting'e Netflix dizisi için başvurdum" · "O başvurudan callback geldi"
- "Bu hafta hedefim 3 başvuru ve 2 self-tape"
- "Cumartesi 14:00 Nişantaşı seçmesine beni hazırla"

---

## Proje yapısı
```
www/                  Arayüz + beyin (HTML/CSS/JS)
android/              Android projesi (Capacitor)
  app/src/main/java/com/burak/jarvis/
    JarvisPlugin.java   Ses tanıma, arama, rehber, uygulama açma, fener, rahatsız etme, izinler, konum, widget
    WakeService.java    "Hey Jarvis" (Vosk, cihaz içi)
    NotifService.java   Bildirim okuma
    GeoStore.java / GeofenceReceiver.java / BootReceiver.java   Konum hatırlatmaları
    JarvisWidget.java   Ana ekran widget'ı
    JarvisA11yService.java  Ekran ajanı (Faz 2)
apps-script/          Google arka ucu (Code.gs: senkron, Gmail, Takvim, radar, KADRO, PC kuyruğu)
pc-agent/             Bilgisayar ajanı (jarvis_pc.py)
.github/workflows/    Bulutta APK derleme (son adım)
```

## APK derleme (son adım: GitHub)
`.github/workflows/apk.yml` hazır. Proje bir GitHub reposuna yüklenince her güncellemede APK otomatik derlenir: **Actions → son çalışma → Artifacts → JARVIS-apk**.
İmza anahtarı (`android/app/jarvis.keystore`) sabit. Yeni sürümü eskisinin üstüne kurabilirsin, verilerin silinmez. Repoyu **özel (private)** tut.

Bilgisayarda derlemek istersen (Android Studio ve JDK 21 kurulu olmalı):
```
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```


## v2.0 — Stüdyo, beyin ve bilgisayarda JARVIS

**Yeni Stüdyo sekmesi (✦):** sunum (.pptx) ve belge (.docx) hazırlama, fotoğraf düzenleme (kırpma, ışık, filtre, yazı, arka plan bulanıklaştırma/kaldırma, toplu düzenleme, en iyi fotoğrafları seçme), görsel üretme (Cloudflare, ücretsiz), Reels/showreel ve fotoğraftan video, otomatik altyazı, self-tape kırpma ve analizi, kompozit kart, portfolyo sitesi, marka kiti. Dosyalar telefonda *İndirilenler/JARVIS*, *Resimler/JARVIS*, *Filmler/JARVIS* klasörlerine kaydedilir ve paylaşılabilir. Sesle de olur: "drama atölyesi hakkında 8 slaytlık sunum hazırla".

- Görsel üretmek için: dash.cloudflare.com → ücretsiz hesap → API Tokens → "Workers AI" şablonu. Token ve Account ID'yi Ayarlar → Stüdyo'ya yaz.

**Beyin:** Plan → Bilgi sekmesine PDF/metin/fotoğraf belge ekle; JARVIS sorularında bunlardan cevap verir. Konuya göre uzman mod (oyunculuk koçu, yazılım, ajans, planlayıcı), hata günlüğü, gizlilik modu, Groq'a otomatik kota geçişi, bilgisayarda Ollama ile yerel beyin, şifreli Drive yedeği.

**Koçlar (Kariyer → Koç):** İngilizce konuşma pratiği, diksiyon hocası, drama eğitmenliği sınav hazırlığı, canlı sahne partneri, ses/beden ısınma, hedef planı. Replik bölümünde ezber modu ve karakter analizi. Canlı modda 📷 ile JARVIS'e kameradan gösterebilirsin.

**Hayat → Kişiler:** düzenli görüşmek istediğin kişileri ekle; zamanı gelince hatırlatır.

**Gece mesaisi:** Ayarlar → Gece mesaisini aç. Her sabah 05:00'te Google tarafında mailler, takvim ve casting radarı taranır, brifinge "gece raporu" eklenir. (Code.gs'yi güncelleyip yeniden dağıt.)

### Google Apps Script güncellemesi
`apps-script/Code.gs` dosyasının tamamını script.google.com'daki projene yapıştır → Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm → Dağıt. (URL değişmez.)

### Bilgisayarda JARVIS (Windows)
1. python.org'dan Python 3.10+ kur ("Add python to PATH" işaretli).
2. Bu depodaki `pc-agent` klasörünü bilgisayara indir (GitHub → Code → Download ZIP).
3. `JARVIS-masaustu-kur.bat`'a çift tıkla. Masaüstüne JARVIS kısayolu gelir.
4. Kısayolla başlat; ilk açılışta Gemini anahtarını (ve istersen Groq anahtarını, Apps Script URL ve TOKEN'ı) sorar.
5. "Hey Jarvis" de ya da **Ctrl+Alt+J**'ye bas, söyle: "Chrome'u aç ve casting ilanları ara", "ekranda ne var", "bu hatayı açıkla", "Word'e şunu yaz", "sesi kıs", "CV dosyamı bul ve maile ekle".
Telefondan da "bilgisayarda şunu yap" diyebilirsin. GTX 1650 için ağır bir şey çalıştırmaz; zekâ bulutta (ücretsiz Gemini).
