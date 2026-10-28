FROM python:3.12-slim
WORKDIR /app
COPY replayer.py .
ENV LB_DISPATCH_URL=http://loadbalancer:8383/dispatch
ENV DATASET_PATH=/app/dataset/flash_crowd_surge.csv
ENV REPLAY_SPEED=1.0
CMD ["python", "replayer.py"]
