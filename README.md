# T.I.T.U.S. — Burak'ın Kişisel Asistanı

Android uygulaması (Capacitor). Tamamen ücretsiz bileşenlerle çalışır. Aynı arayüz tarayıcıda da açılır (tablet/bilgisayar).

## Neler yapıyor

| Alan | Özellikler |
|---|---|
| **Konuşma** | "Hey Titus" ile uyanma (ekran kapalıyken bile), Türkçe ses tanıma, sesli cevap, soru sorunca otomatik dinleme, konuşurken reaktöre dokunup sözünü kesme |
| **Beyin** | Google Gemini (ücretsiz) ya da ileride Claude. 56 araç kullanır, kalıcı hafıza tutar |
| **Hatırlatma** | Uygulama kapalıyken de çalan alarmlar (tek sefer / her gün / hafta içi / haftalık / aylık), konum hatırlatması ("Kadıköy'e varınca…"), 10 dk erteleme |
| **Telefon** | Rehberden arama ("annemi ara"), WhatsApp ve SMS taslağı, uygulama açma, fener, rahatsız etme, gelen bildirimleri sesli özetleme |
| **Plan** | Görevler (proje etiketli), notlar, sabah brifingi ve gün sonu özeti (bildirimle), hava durumu |
| **Hayat** | Harcama takibi ve 30 günlük rapor, alışkanlıklar (seri takibi), odak/pomodoro modu |
| **Kariyer** | Seçme/çekim takibi (bir gün önce akşam 20:00'de ve 2 saat önce hatırlatma), bar vardiyaları (1 saat önce ve bitişte "eve dönüş" hatırlatması), proje durumları, **replik çalışma** (diğer karakterleri Titus okur, sıra sana gelince dinler) |
| **Google** | Gmail özeti, Google Takvim okuma ve etkinlik ekleme, telefon/tablet/bilgisayar arasında veri senkronu |
| **Ekran** | Iron Man HUD arayüzü, ana ekran widget'ı (Konuş + Brifing) |

### Faz 1 (bu sürümde)
| Alan | Özellikler |
|---|---|
| **Proaktif** | Yarın yağmur varsa akşamdan uyarı, 3 günden uzun bekleyen görevler, yarınki seçme için replik dürtmesi, bütçe uyarısı, yaklaşan özel günler, takip zamanı gelen başvurular; her pazar 20:00 haftalık rapor |
| **Rutinler** | Hazır: "Vardiyaya çıkıyorum" (sessiz + vardiya bitişine alarm + partnerine "çıktım" taslağı), "Eve geldim", "İyi geceler", "Günaydın". Kendi rutinlerini Plan → Rutin'den ya da sesle oluştur. Ev konumu kaydedilirse eve varınca "Eve geldim" için bildirim gelir |
| **Görme ve ses** | Fotoğraftan kayıt (fiş → harcama, ilan → seçme), sesli not/toplantı kaydı → özet + görevler + hatırlatıcılar, internette güncel arama |
| **Self-tape** | Replik bölümünde 3-2-1 sonra kamera kaydı; diğer karakterleri Titus okur, video galeride Movies/TITUS klasörüne kaydedilir |
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
3. Titus → **Ayarlar → Beyin → Gemini API anahtarı** kısmına yapıştır, sonra **Bağlantıyı test et**.

> Not: Ücretsiz katmanda günlük istek sınırı var ve Google gönderilen içeriği ürünlerini geliştirmek için kullanabilir. Çok özel bilgileri buna göre paylaş.
> Model adı çalışmazsa uygulama sıradaki ücretsiz modele kendisi geçer.

## 2) İlk açılışta izinler
**Ayarlar → İzinler** bölümünde her satırda "İzin ver" düğmesi var:
- **Bildirim** ve **Tam zamanlı alarm**: hatırlatıcıların dakikasında çalması için
- **Mikrofon**: sesli komut
- **Rehber** ve **Telefon**: "annemi ara"
- **Bildirim erişimi**: gelen bildirimleri okuyabilmesi için (açılan ekranda Titus'u etkinleştir)
- **Rahatsız etme erişimi**: odak modu
- **Konum** ve **Konum: her zaman**: konum hatırlatmaları
- **Diğer uygulamaların üzerinde**: "Hey Titus" deyince ekranı açabilmesi için
- **Pil kısıtlamasız**: Xiaomi, Samsung gibi telefonlarda arka planda kapanmasın diye

## 3) "Hey Titus"
Ayarlar → **Hey Titus**'i aç. İlk seferde yaklaşık 40 MB'lık açık kaynak ses modeli (Vosk) iner, sonra tamamen internetsiz çalışır. Bildirim çubuğunda "Titus dinlemede" yazar.
- "Hey Titus" de → Titus "Efendim?" der ve dinler.
- Pil kullanır. İstemediğinde bildirimden **Kapat**'a bas.
- Android 14 ve sonrası, telefon yeniden başlayınca mikrofon servisinin kendiliğinden açılmasına izin vermiyor. Titus'u bir kez açman yeterli.

## 4) Google bağlantısı (isteğe bağlı: senkron, Gmail, Takvim)
1. https://script.google.com → **Yeni proje**.
2. `apps-script/Code.gs` içeriğini yapıştır. En üstteki `TOKEN` değerini uzun, sana özel bir şifreyle değiştir.
3. Proje ayarlarında saat dilimini **Europe/Istanbul** yap (ya da `appsscript.json` içeriğini kullan).
4. **Dağıt → Yeni dağıtım → Web uygulaması**. Çalıştıran: **Ben**, Erişim: **Herkes**. Çıkan izin ekranlarını onayla.
5. Verilen `…/exec` adresini ve TOKEN'ı Titus → **Ayarlar → Google**'a yaz, sonra **Test et**.
6. Tablet ya da bilgisayarda aynı ayarları girince veriler eşitlenir.

Veriler senin Google Drive'ında `jarvis-veri.json` dosyasında durur. Gizli anahtarı kimseyle paylaşma.

## 5) Daha doğal Türkçe ses
Telefon Ayarlar → **Metin okuma çıkışı** → Google Konuşma Hizmetleri → Türkçe ses verilerini indir. Sonra Titus → Ayarlar → Ses'ten bir ses seç ve hız/ton ayarla.

## 6) Faz 1–2 kurulumları (isteğe bağlı)
- **Ekran erişimi:** Ayarlar → Güvenlik → Ekran erişimi → Aç → listeden "Titus ekran asistanı"nı aç. APK ile kurulduğu için Android 13+ bunu gri gösterebilir. O zaman telefon Ayarlar → Uygulamalar → Titus → sağ üst ⋮ → **Kısıtlanmış ayarlara izin ver**, sonra tekrar dene.
- **Parmak izi kilidi / kulaklık tuşu:** Ayarlar → Güvenlik ve kısayollar'dan aç.
- **Ev konumu:** Evdeyken Ayarlar → Kişisel → **Burası evim**.
- **Uyandırmayı sesine uyarla:** Hey Titus açıkken Ayarlar → **Kalibre et**.
- **KADRO:** KADRO'nun Google E-Tablo linkindeki `/d/` ile `/edit` arasındaki kimliği Ayarlar → İş bağlantıları'na yapıştır.
- **Radar:** Aynı bölümde kaynak ekle. Gmail için arama (ör. `casting OR seçme OR "oyuncu aranıyor"`), web için ilan sayfası linki ve anahtar kelimeler gir, sonra **Radarı Google'a kaydet**. Anlık bildirim istersen telefona ücretsiz **ntfy** uygulamasını kur, tahmin edilmesi zor bir konu adına abone ol, aynı adı ayara yaz.
- **Apps Script güncellemesi:** Bu sürümde `Code.gs` büyüdü. Yeni halini yapıştırıp **Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm** de. İlk radar kaydında saatlik tarama izni ister.
- **Bilgisayar ajanı:** Bilgisayara Python 3 kur, `pc-agent/jarvis_pc.py` dosyasını çalıştır (Windows'ta `Titus-baslat.bat`). İlk açılışta Apps Script URL'si ve TOKEN'ı sorar. Açık kaldığı sürece telefondan komut alır.
- **Akıllı ev:** Ayarlar → Akıllı ev'e cihaz adı ve webhook linki ekle (Home Assistant, IFTTT Webhooks ya da Smart Life + IFTTT).
- **Doğal ses (Piper):** Ayarlar → Doğal Türkçe ses kartındaki 4 adım.

## v1.5: Canlı konuşma, doğal ses, Groq
- **Canlı konuşma (Gemini Live):** "Hey Titus" deyince ya da mikrofona basınca gerçek zamanlı sohbet açılır. Anında cevap verir, konuşurken sözünü kesebilirsin. 25 sn sessizlikte kapanır (Ayarlar'dan değişir). Kota dolarsa kendiliğinden normal moda geçer.
- **Akışlı cevap:** Normal modda cevabın ilk cümlesi hazır olur olmaz konuşmaya başlar.
- **Doğal ses:** Gemini'nin insan gibi sesi. Ücretsiz ses kotası dolarsa telefonun sesine geçer.
- **Groq (ücretsiz):** console.groq.com'dan anahtar alıp Ayarlar → Groq'a gir. Ses tanıma Whisper ile çok hızlanır. Gemini kotası dolarsa Titus Groq ile çalışmaya devam eder.
- **Hazır brifing:** Apps Script her saat takvim ve mail verisini hazırlar, "Günaydın" deyince beklemeden gelir. Code.gs'i güncelleyip yeni sürüm olarak dağıtman gerekir.
- **Haftalık hafıza özeti:** Titus her hafta sohbetlerini özetleyip hatırlar.

### Vivo telefonlar için (önemli)
Vivo, arka plandaki uygulamaları agresif kapatır. Titus'un sürekli çalışması için:
1. Ayarlar → Pil → **Arka planda yüksek güç tüketimi** → Titus'u aç.
2. Ayarlar → Uygulamalar → **Otomatik başlatma** → Titus'u aç.
3. Son uygulamalar ekranında Titus'u aşağı çekip **kilitle** (asma kilit simgesi).

## Bilinen sınırlar
- Canlı modda hoparlörden konuşurken Titus'un sözünü kesmek için biraz yüksek sesle konuşman gerekir (kendi sesini duymasın diye). Kulaklıkla bu ayarı açabilirsin.
- Kulaklık tuşu, başka bir müzik/podcast uygulaması çalarken o uygulamaya gider.
- "Ekranımda ne var?" için Android 11+ gerekir. Daha eski sürümlerde sadece ekrandaki yazıları okur.
- Radar, otomatik okumayı engelleyen sitelerde (ör. bazı emlak siteleri) sonuç bulamayabilir. Gmail ilan bildirimleri her zaman çalışır.
- Yol süresi trafik payıyla tahmini hesaplanır. Canlı toplu taşıma saatleri için Titus Google Haritalar'ı açar.
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
    WakeService.java    "Hey Titus" (Vosk, cihaz içi)
    NotifService.java   Bildirim okuma
    GeoStore.java / GeofenceReceiver.java / BootReceiver.java   Konum hatırlatmaları
    JarvisWidget.java   Ana ekran widget'ı
    JarvisA11yService.java  Ekran ajanı (Faz 2)
apps-script/          Google arka ucu (Code.gs: senkron, Gmail, Takvim, radar, KADRO, PC kuyruğu)
pc-agent/             Bilgisayar ajanı (jarvis_pc.py)
.github/workflows/    Bulutta APK derleme (son adım)
```

## APK derleme (son adım: GitHub)
`.github/workflows/apk.yml` hazır. Proje bir GitHub reposuna yüklenince her güncellemede APK otomatik derlenir: **Actions → son çalışma → Artifacts → Titus-apk**.
İmza anahtarı (`android/app/jarvis.keystore`) sabit. Yeni sürümü eskisinin üstüne kurabilirsin, verilerin silinmez. Repoyu **özel (private)** tut.

Bilgisayarda derlemek istersen (Android Studio ve JDK 21 kurulu olmalı):
```
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```


## v2.0 — Stüdyo, beyin ve bilgisayarda Titus

**Yeni Stüdyo sekmesi (✦):** sunum (.pptx) ve belge (.docx) hazırlama, fotoğraf düzenleme (kırpma, ışık, filtre, yazı, arka plan bulanıklaştırma/kaldırma, toplu düzenleme, en iyi fotoğrafları seçme), görsel üretme (Cloudflare, ücretsiz), Reels/showreel ve fotoğraftan video, otomatik altyazı, self-tape kırpma ve analizi, kompozit kart, portfolyo sitesi, marka kiti. Dosyalar telefonda *İndirilenler/JARVIS*, *Resimler/JARVIS*, *Filmler/JARVIS* klasörlerine kaydedilir ve paylaşılabilir. Sesle de olur: "drama atölyesi hakkında 8 slaytlık sunum hazırla".

- Görsel üretmek için: dash.cloudflare.com → ücretsiz hesap → API Tokens → "Workers AI" şablonu. Token ve Account ID'yi Ayarlar → Stüdyo'ya yaz.

**Beyin:** Plan → Bilgi sekmesine PDF/metin/fotoğraf belge ekle; Titus sorularında bunlardan cevap verir. Konuya göre uzman mod (oyunculuk koçu, yazılım, ajans, planlayıcı), hata günlüğü, gizlilik modu, Groq'a otomatik kota geçişi, bilgisayarda Ollama ile yerel beyin, şifreli Drive yedeği.

**Koçlar (Kariyer → Koç):** İngilizce konuşma pratiği, diksiyon hocası, drama eğitmenliği sınav hazırlığı, canlı sahne partneri, ses/beden ısınma, hedef planı. Replik bölümünde ezber modu ve karakter analizi. Canlı modda 📷 ile Titus'a kameradan gösterebilirsin.

**Hayat → Kişiler:** düzenli görüşmek istediğin kişileri ekle; zamanı gelince hatırlatır.

**Gece mesaisi:** Ayarlar → Gece mesaisini aç. Her sabah 05:00'te Google tarafında mailler, takvim ve casting radarı taranır, brifinge "gece raporu" eklenir. (Code.gs'yi güncelleyip yeniden dağıt.)

### Google Apps Script güncellemesi
`apps-script/Code.gs` dosyasının tamamını script.google.com'daki projene yapıştır → Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm → Dağıt. (URL değişmez.)

### Bilgisayarda Titus (Windows)
1. python.org'dan Python 3.10+ kur ("Add python to PATH" işaretli).
2. Bu depodaki `pc-agent` klasörünü bilgisayara indir (GitHub → Code → Download ZIP).
3. `Titus-masaustu-kur.bat`'a çift tıkla. Masaüstüne Titus kısayolu gelir.
4. Kısayolla başlat; ilk açılışta Gemini anahtarını (ve istersen Groq anahtarını, Apps Script URL ve TOKEN'ı) sorar.
5. "Hey Titus" de ya da **Ctrl+Alt+J**'ye bas, söyle: "Chrome'u aç ve casting ilanları ara", "ekranda ne var", "bu hatayı açıkla", "Word'e şunu yaz", "sesi kıs", "CV dosyamı bul ve maile ekle".
Telefondan da "bilgisayarda şunu yap" diyebilirsin. GTX 1650 için ağır bir şey çalıştırmaz; zekâ bulutta (ücretsiz Gemini).


## v2.1 — Adı artık Titus + Recast brief akışı
- Uyandırma kelimesi: **"Hey Titus"** (bilgisayarda da). Eski "Hey Jarvis" artık uyandırmaz.
- **Kariyer → Recast:** brief'i yapıştır ya da "Gmail'den getir". Titus rolleri çıkarır, KADRO'dan uygun oyuncuları puanlayıp seçer; işaretleri düzelt, "Müşteri mail taslağını oluştur" de. Seçilen oyunculara BCC duyuru taslağı da hazırlar. Hiçbir şey sen göndermeden gitmez.
- Sesle: "son brief'i hazırla", "teklif mailini oluştur".
- Ayarlar → Recast Brief: yeni brief maili gelince haber ver.
- Code.gs'yi yine güncelleyip yeni sürüm olarak dağıt (roster, briefMails, BCC eklendi).

## v2.2 — Kırmızı tema + Recast Audition erişimi
- Arayüz, widget ve uygulama simgesi kırmızı.
- **Titus artık Recast Audition'a erişiyor:** işleri, başvuruları, tape durumlarını ve gönderimleri okuyup senin istediğin gibi düzenliyor ("Kahve reklamının son teslimini cumaya al", "Elif'in tape'ini onaylı yap", "Molla işini kapat"). Her değişiklik önce onay kutusuyla gelir, "geri al" diyebilirsin.
- Kurulum: Ayarlar → Recast Audition → uygulama adresini yaz (tablo kimliği isteğe bağlı) → "Bağlantıyı dene". Titus'un Google bağlantısı Audition'ın kurulu olduğu hesapla aynı olmalı. Code.gs'yi güncelleyip yeni sürüm olarak dağıt.
- Not: Titus doğrudan veriyi düzenler; Audition'ın kendi bildirim mailleri bu düzenlemelerde tetiklenmez.

## v2.4 — Kesintisiz, doğal sohbet (telefon + bilgisayar)
- Sadece **"Titus"** demen yeter; sonra normal konuş, her cümlede adını söyleme. "Görüşürüz / bu kadar / sağ ol" deyince ya da 45 sn sessiz kalınca sohbet kapanır.
- Tek açık bağlantı (Gemini Live): sen konuşurken dinler, araya girersen susar, cevabı anında sesli akıtır. Bağlantı koparsa ya da süre dolarsa kaldığı yerden sessizce devam eder; sohbet süresi sınırsız.
- Mikrofon bağlantıdan önce açılır: "Titus" der demez konuşmaya başlayabilirsin, ilk kelimeler kaybolmaz. Önceki konuşmayı hatırlayarak başlar.
- Konuşma tarzı: kısa, doğal, insan gibi sıra alan, araya giren sözü kibarca karşılayan bir sohbet.
- Bilgisayar: aynı canlı sohbet + pencerede canlı yazıya dökme. Hoparlörle kendi sesini duyup kesilirse kulaklık kullan, Ayarlar → "Kulaklık kullanıyorum".

## v2.6 — Uygulamalar, sağlamlık, video, tek kodla bağlantı
- **Uygulamalar** (telefon: Stüdyo → Uygulamalar ya da ana ekrandaki 🧩; bilgisayar: Uygulamalar sekmesi): birlikte yapılan 22 uygulama tek yerde; "Titus, Uyku Transı'nı aç". KADRO ve Recast Audition'ın Netlify adreslerini Ayarlar → Uygulama adresleri'ne bir kez yaz.
- **Uyku** (telefon: Hayat → Uyku): yerleşik sesli hipnoz/gevşeme seansı.
- **Video**: "şu konuda video oluştur" — senaryo, sahne görselleri, seslendirme, altyazı. Cloudflare bağlı değilse anahtarsız ücretsiz görsel servisi kullanılır. Bilgisayarda Videolar/Titus'a kaydedilir.
- **HTTP 400 hataları**: sohbet geçmişi her istekte düzeltilir, hata gelirse otomatik yeniden denenir, olmazsa Groq'a geçilir. Hatalar Ayarlar → Son hatalar'da.
- **Ayarlar**: katlanır başlıklar + arama.
- **Bilgisayarı bağla**: telefonda Ayarlar → Bilgisayarı bağla → kod; bilgisayarda Ayarlar'a yapıştır. Bilgisayardaki Titus Gmail, takvim, KADRO kullanır; "telefonda şunu yap" der; telefon "bilgisayara söyle" der.
- Code.gs'yi güncelleyip yeni sürüm olarak dağıt (phPush/phPull eklendi).

## v2.7 — Dosya/görsel analizi, kimliği koruyan montaj, modeller, konuşan video
- 📎 ile fotoğraf, PDF, Word, Excel, metin, ses ve kısa video eklenir; sonraki 4 soruda da bağlamda kalır. Bilgisayarda sürükle-bırak ve Ctrl+V de çalışır.
- **Fotoğraf montajı**: "beni Paris'te gün batımında göster" — yüz, el, kol değişmeden yeni ortam. Ücretsiz motor: Hugging Face FLUX Kontext (Ayarlar'a ücretsiz HF token ekle; günde birkaç hak).
- **Modeller**: 1-3 fotoğrafla bir kişiyi kaydet ("bunu Burak adıyla model olarak kaydet"); görsellerde ve videolarda aynı yüzle kullanılır. Telefon ve bilgisayar ortak (Drive'daki "TITUS Modeller").
- **İsteğe sadık görsel**: istek ayrıntılandırılır → üretilir → Gemini görsele bakıp isteğe uyup uymadığını puanlar → eksikse düzeltip yeniden üretir.
- **Konuşan video** (bilgisayar): model + metin → seslendirme → Hugging Face'teki ücretsiz dudak senkronu alanları. Alanlar dolu/kapalıysa o sahne hareketli fotoğraf + ses olarak eklenir ve bunu söyler.
- Code.gs'yi güncelleyip yeni sürüm olarak dağıt (listFolder, getFileB64, saveFile replace).

## v3.0 — Büyük güncelleme: Faz 1–10'un tamamı (364 yetenek) + çoklu Gmail

- **Yetenekler ekranı** (ana sayfada 🧠 Yetenekler, Ayarlar'ın en üstü; bilgisayarda "Yetenekler" sekmesi): 365 maddenin hepsi tek katalogda (`www/skills.json`, `pc-agent/skills.json`). Ara, faza göre süz, çalıştır, sonucu kopyala/not al/Word belgesi yap/sesli okut. Her maddede dürüst durum işareti: ✅ tam · 🧠 yapay zekâ ile · ◐ kısmi · ✕ yapılamıyor.
- Sohbetten de çalışır: `yetenek_calistir`, `yetenek_ara` araçları; isteğe uyan yetenekler otomatik önerilir. Davranış modları (adım adım düşünme, uydurmama, onay noktaları, talimat tuzağı koruması…) varsayılan açık; tek tek kapatılabilir.
- **Birden fazla Gmail hesabı**: her hesap için o hesapla Code.gs'yi ayrı dağıt → Yetenekler → "Birden fazla Gmail hesabı" → ad + link + şifre → Test. `mail_ozeti` hepsini birleştirir ya da "iş hesabımdaki mailler" diye seçilir; taslak hangi hesaptan istenirse oradan. Eşleştirme kodu ek hesapları bilgisayara da taşır.
- **Otomatik güncelleme**: telefonda yeni APK çıkınca sohbette "İndir ve kur" düğmesi; bilgisayarda "Titus'u güncelle" deyince zip'i indirip kurar ve yeniden başlar.
- **Takipler** (sayfa/fiyat/konu), **Telegram'dan Titus**, **dışarıdan komut adresi** (Tasker/Kısayollar), **ortak liste**, **anket (Google Form + karekod)**, **proje yedeği Drive'a** — hepsi Google tarafında ücretsiz.
- Derin araştırma (paralel alt sorular, kaynak puanı, çelişkiler, Word raporu, kaldığı yerden devam), ajan ekibi (araştırmacı → yazar → denetçi), hesap/tablo/grafik çalışma alanı (kod çalıştırarak), uygulama fabrikası, hafıza yöneticisi, özel asistanlar, canlı çeviri, self-tape yönetmeni, konuşan Titus yüzü, kurallar (eğer–o zaman), zamanlı mesaj, geri al, eylem günlüğü, izin sistemi, sesli parola, veri maskeleme, akıllı önbellek, misafir modu, tema/büyük yazı/tek el/okuma dostu yazı, şarkı/ses/tempo ölçer, çizgi roman/storyboard/moodboard, GIF, kavram/ilişki/bloklama şemaları ve fazlası.
- Bilgisayara özel: müzik ve ses efekti üretici, görselden 3D (Hugging Face, ücretsiz kota), ekran kaydıyla eğitim videosu, yapışkan not panosu (Ctrl+Alt+N), hızlı pencere (Ctrl+Alt+T).

**Kurulum (bir kez):** Apps Script'te Code.gs'yi yeni sürümle değiştir → Kaydet → Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm → Dağıt (Google Form ve tetikleyici izni ister: izin ver). Bilgisayarda yeni zip'i eskinin üstüne çıkar.
