FROM python:3.12-slim
WORKDIR /app
# Install docker CLI for scaling
RUN apt-get update && apt-get install -y --no-install-recommends docker.io && rm -rf /var/lib/apt/lists/*
COPY daemon.py .
ENV LB_URL=http://loadbalancer:8383/metrics
ENV PORT=8080
ENV AMF_CAPACITY=100.0
ENV TARGET_GAMMA=0.80
ENV HORIZON_SEC=45
EXPOSE 8080
CMD ["python", "daemon.py"]
