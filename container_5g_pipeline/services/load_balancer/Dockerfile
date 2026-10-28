FROM python:3.12-slim
WORKDIR /app
COPY app.py .
ENV PORT=8383
ENV AMF_ENDPOINTS=http://amf-worker-1:8000,http://amf-worker-2:8000
EXPOSE 8383
CMD ["python", "app.py"]
