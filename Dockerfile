# Branchwise: one container serves the API and the built website (Cloud Run).

# 1. Build the frontend
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2. Python runtime
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ backend/
COPY config/ config/
COPY scripts/build_signals.py scripts/
COPY data/sydney_pois.parquet data/dataset.json data/
COPY --from=web /web/dist frontend/dist
# Precompute per-category signals in the image so a new instance starts in ~0.3 s
RUN APP_ENV=build SECRET_KEY=build-only python scripts/build_signals.py
RUN useradd --uid 10001 --no-create-home app && chown -R app /srv
USER app
ENV APP_ENV=production STORAGE=firestore SERVE_FRONTEND=true
CMD exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8080} \
    --proxy-headers --forwarded-allow-ips='*' --no-server-header
