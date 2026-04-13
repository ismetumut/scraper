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
