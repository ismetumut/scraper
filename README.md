# Lead List Manager (CSV-first)

Bu proje, Sales Navigator gibi platformlardan doğrudan scraper çalıştırmak yerine,
kullanıcının **izinli şekilde aldığı CSV listeleri** yönetmek için tasarlandı.

## Özellikler
- CSV lead dosyası yükleme
- Header algılama ve import detaylarını görme
- Canonical alanlara (`full_name`, `title`, `company`, `linkedin_url`, `email`, `country`) mapping atama
- Normalize + dedupe (`linkedin_url` ve `email`)
- Filtreleme (`country`, `company`, `title_keyword`)
- Temiz listeyi CSV olarak export etme
- Netlify Functions üzerinden deploy desteği

## Lokal Kurulum
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API docs: http://127.0.0.1:8000/docs

## Netlify Deploy
Bu repo FastAPI uygulamasını Netlify'da `/.netlify/functions/api` altında çalıştırır.
`netlify.toml` içinde tek bir catch-all rewrite vardır: tüm yollar function'a gider.
Mangum ayarında `api_gateway_base_path="/.netlify/functions/api"` kullanıldığı için FastAPI route'ları doğru eşleşir.

Örnekler:
- `/health` -> function içinde `/health`
- `/docs` -> function içinde `/docs`

## API Akışı
1. `POST /imports` (CSV yükle)
2. `GET /imports/{import_id}` (algılanan header + efektif mapping)
3. `POST /imports/{import_id}/map` (opsiyonel özel mapping)
4. `POST /imports/{import_id}/process`
5. `GET /leads?country=Turkey&title_keyword=Manager`
6. `POST /exports`
7. `GET /exports/latest`

## Önemli Not
Bu servis LinkedIn/Sales Navigator hesabına otomatik giriş yapmaz ve doğrudan sayfa scrape etmez.
Bu yaklaşım, platform koşulları ve veri uyumluluğu açısından daha güvenli bir temeldir.
