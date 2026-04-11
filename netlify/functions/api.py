from mangum import Mangum

from app.main import app

# Netlify function URL prefix must be stripped for FastAPI route matching.
handler = Mangum(app, api_gateway_base_path="/.netlify/functions/api")
