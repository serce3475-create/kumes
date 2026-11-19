# Kümes Defteri – Kurulum Kılavuzu

Bireysel kullanım için, internetsiz çalışan, iPhone + Android uyumlu kümes yönetim uygulaması.
App Store / Play Store gerekmez. Mevcut SKYFLEET projesine dokunmaz; ayrı bir uygulamadır.

## Ne var?
- Birden fazla kümes (üstteki menüden "＋ Yeni kümes"), her kümenin verisi ayrı
- Kuşlar (fotoğraf, künye, arama), 3 nesil pedigre (yazdır/PDF)
- Eşleşme, kuluçka takibi (18–21. gün uyarısı), sağlık/aşı (sonraki tarih uyarısı)
- Yarış, alış/satış, notlar, "Bugün" ekranı
- Veriler sadece telefonda (IndexedDB) durur; internet gerekmez

## 1) Bir kere internete koy (ücretsiz, 5 dakika)
Uygulama bir "PWA"dır; telefona kurulabilmesi için dosyaların bir kez HTTPS adresinde durması gerekir.
En kolayı **Cloudflare Pages** veya **GitHub Pages**:

**Cloudflare Pages:** dash.cloudflare.com → Workers & Pages → Create → Pages → "Upload assets" → bu klasörün içindekileri (index.html, app.js, ... hepsi) yükle → adres verir (örn. `kumes.pages.dev`).

**GitHub Pages:** yeni bir repo aç, dosyaları yükle, Settings → Pages → Branch: main → adres verir.

Adresi başkasına verme; kimse sana ait veriyi göremez (veri zaten telefonunda), ama adres açık olur.

## 2) Telefona kur
- **iPhone:** Safari ile adresi aç → Paylaş → **Ana Ekrana Ekle**. Uygulamayı mutlaka ana ekrandaki simgeden aç (Safari sekmesinde iOS veriyi silebilir).
- **Android:** Chrome ile aç → ⋮ → **Ana ekrana ekle / Uygulamayı yükle**.

Bir kez açıldıktan sonra internetsiz de çalışır.

## 3) Yedekleme
1. **Dosya yedeği (her zaman çalışır):** Daha → Yedekleme → "Yedek dosyası oluştur ve paylaş" → iCloud Drive / Google Drive / Dosyalar'a kaydet. Geri yüklemek için aynı ekrandan dosyayı seç (Birleştir veya Tamamen değiştir).
2. **Otomatik Google Drive yedeği:** internet/Wi‑Fi olunca, veri değiştiyse kendiliğinden yedek alır (günde 1 dosya, son 7 gün saklanır, uygulamanın gizli Drive klasöründe). Kurulum aşağıda.
3. **Yerel kopyalar:** Geri yüklemeden / kümeyi silmeden önce otomatik alınır (son 3). Telefon kaybına karşı değildir.

### Google Drive otomatik yedeği kurulumu (bir kez)
1. console.cloud.google.com → yeni proje oluştur.
2. "APIs & Services → Library" → **Google Drive API** → Enable.
3. "OAuth consent screen" → External → uygulama adı yaz, kendi e‑postanı "Test users" listesine ekle.
4. "Credentials → Create credentials → OAuth client ID" → tür: **Web application**.
   **Authorized JavaScript origins** kısmına 1. adımdaki sitenin adresini yaz (örn. `https://kumes.pages.dev`, sonda `/` olmadan).
5. Çıkan **Client ID**'yi kopyala → uygulamada Daha → Yedekleme → "Google Client ID" alanına yapıştır → "Otomatik yedek" kutusunu işaretle → "Şimdi yedekle", Google hesabını seç ve izin ver.

## Dürüst notlar
- **Wi‑Fi algılama sadece Android'de** çalışır. iPhone bağlantı türünü okutmaz; iPhone'da internet varsa (hücresel dahil) yedek alınabilir. Hücresel istemiyorsan "Sadece Wi‑Fi" kutusunu kapat ve otomatik yedeği iPhone'da kapalı tut, elle yedek al.
- Otomatik yedek **uygulama açıkken/açılırken** çalışır; arka planda kapalı uygulama yedek alamaz (iOS/Android sınırı). Uygulamayı arada aç.
- Google erişim izni zaman aşımına uğrayınca (özellikle iPhone) bir kez dokunmanız istenebilir. Test modundaki Google uygulamalarında izin 7 günde bir yenilenmesi gerekebilir.
- Drive yedek kodu gerçek Google hesabıyla bu ortamda denenemedi; ilk kurulumda "Şimdi yedekle" ile mutlaka deneyin. Çalışmazsa dosya yedeği her zaman çalışır.
- Çevrimdışı bildirim güvenilir olmadığı için hatırlatmalar **Bugün** ekranındadır; ara sıra açıp bakın.
- Bu klasördeki dosyaları güncellersen (yeni sürüm), uygulamayı bir kez kapatıp açman gerekebilir.
- Düzenli olarak dosya yedeğini de al: biri telefonla, biri bulutla.
