FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model at build time so startup is fast
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True)"

COPY app.py .

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
