# Sales Navigator Scraper

PhantomBuster tarzı LinkedIn Sales Navigator list scraper. Kaydedilmiş listelerinizden lead bilgilerini otomatik olarak çeker.

## Ozellikler

- Sales Navigator kaydedilmis listeleri otomatik scrape
- Lead bilgileri: Ad, Soyad, Unvan, Sirket, Lokasyon, Profil URL
- CSV ve JSON export
- Real-time progress tracking
- Anti-detection (rastgele delay, human-like scrolling)
- Modern dark-theme dashboard (PhantomBuster tarzi)
- Saved lists auto-detect

## Kurulum

```bash
# Bagimliliklar
npm install

# .env dosyasi olustur
cp .env.example .env

# .env dosyasina LinkedIn cookie bilgilerini gir
# (asagidaki talimatlara bak)
```

## Calistirma

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

Tarayicida ac: **http://localhost:3099**

## LinkedIn Cookie Alma

1. Chrome'da **LinkedIn**'e giris yap
2. **F12** ile Developer Tools ac
3. **Application** > **Cookies** > **linkedin.com**
4. **li_at** cookie degerini kopyala
5. **JSESSIONID** degerini kopyala
6. `.env` dosyasina yapistir

## .env Ayarlari

```env
PORT=3099
LINKEDIN_SESSION_COOKIE=your_li_at_cookie_here
LINKEDIN_CSRF_TOKEN=your_csrf_token_here
SCRAPE_DELAY_MIN=2000
SCRAPE_DELAY_MAX=5000
MAX_PAGES_PER_RUN=25
HEADLESS=true
```

## API Endpoints

| Method | Endpoint | Aciklama |
|--------|----------|----------|
| GET | `/api/scraper/lists` | Kayitli listeleri getir |
| POST | `/api/scraper/start` | Scraping baslat |
| GET | `/api/scraper/status/:jobId` | Job durumu |
| GET | `/api/scraper/results/:jobId` | Sonuclari getir |
| GET | `/api/scraper/jobs` | Tum joblari listele |
| DELETE | `/api/scraper/jobs/:jobId` | Job sil |
| GET | `/api/export/:jobId/csv` | CSV export |
| GET | `/api/export/:jobId/json` | JSON export |

## Gunluk Baglanti Takibi (Yeni Baglanti Bildirimi)

Belirledigin 1. derece baglantilarinin (baglanti listesi herkese acik olanlarin)
her gun yeni ekledigi baglantilari otomatik tespit edip e-posta ile bildirir.

### 1. Takip edilecek kisileri tanimla

`config/connections-targets.json` dosyasini duzenle:

```json
[
  {
    "name": "Ahmet Yilmaz",
    "profileUrl": "https://www.linkedin.com/in/ahmet-yilmaz/"
  },
  {
    "name": "Ayse Demir",
    "profileUrl": "https://www.linkedin.com/in/ayse-demir/"
  }
]
```

> Not: Bir kisinin baglanti listesini gorebilmek icin o kisinin
> "Baglantilarimi kim gorebilir" ayarini "Herkes" yapmis olmasi gerekir.

### 2. .env ayarlarini tamamla

`.env` dosyasina LinkedIn cookie bilgilerinin yaninda SMTP ve bildirim
e-posta adresini ekle:

```env
NOTIFY_EMAIL=ismetumut@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_email@gmail.com
```

> Gmail kullaniyorsan normal sifre yerine bir "Uygulama Sifresi" (App Password)
> olusturman gerekir.

### 3a. Web panelden yonet (kolay yol)

Sunucuyu baslat ve panelden takip edilecek kisileri ekle/cikar, tek tikla
kontrol calistir ve yeni baglantilari gor:

```bash
npm start
```

Tarayicida **http://localhost:3099** ac > sol menuden **"Connection Tracker"**:

- **Kisi ekle:** isim + LinkedIn profil URL gir, "+ Ekle"
- **Bugünü Kontrol Et:** tum takip edilen kisileri tarar, onceki gunle
  karsilastirir ve yeni baglantilari tablo + "Görüntüle" ile gosterir
- **Sil:** bir kisiyi takipten cikar

Panelden eklenen kisiler `config/connections-targets.json` dosyasina yazilir,
yani gunluk otomasyon (asagidaki GitHub Actions) ayni listeyi kullanir.

### 3b. Scripti elle calistir

```bash
npm run connections:check
```

Script her takip edilen kisi icin:

1. Baglanti listesini cekip `data/connections/<kisi>/<YYYY-MM-DD>.json` olarak kaydeder.
2. Bir onceki kayitla karsilastirip (diff) yeni eklenen baglantilari bulur.
3. Tum kisiler icin ozet bir rapor olusturup `NOTIFY_EMAIL` adresine mail atar.

### 4. Otomatik (gunluk) calistirma

`.github/workflows/daily-connections-check.yml` dosyasi her gun 06:00 UTC'de
otomatik calisacak sekilde ayarlanmistir (GitHub Actions). Repo ayarlarindan
asagidaki secrets'lari eklemen gerekir:

- `LINKEDIN_SESSION_COOKIE`, `LINKEDIN_CSRF_TOKEN`
- `NOTIFY_EMAIL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

İstersen Actions sekmesinden "Run workflow" diyerek manuel de calistirabilirsin.

## Tech Stack

- **Backend:** Node.js, Express
- **Scraping:** Puppeteer (headless Chrome)
- **Frontend:** Vanilla HTML/CSS/JS
- **Storage:** JSON dosyalari

## Proje Yapisi

```
sales-navigator-scraper/
├── src/
│   ├── server.js              # Express server
│   ├── routes/
│   │   ├── scraper.js         # Scraper API routes
│   │   └── export.js          # CSV/JSON export routes
│   ├── services/
│   │   ├── browser.js         # Puppeteer browser yonetimi
│   │   └── navigator-scraper.js  # Ana scraping motoru
│   └── utils/
│       ├── delay.js           # Rate limiting
│       └── store.js           # Veri kayit/okuma
├── public/
│   ├── index.html             # Dashboard UI
│   ├── css/style.css          # Stiller
│   └── js/app.js              # Frontend JS
├── data/                      # Scrape sonuclari
├── package.json
├── .env.example
└── .gitignore
```
