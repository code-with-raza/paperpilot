FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PAPERPILOT_DATA_DIR=/data
WORKDIR /app
COPY requirements.txt .
RUN pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r requirements.txt
COPY . .
CMD ["python", "deploy.py"]
