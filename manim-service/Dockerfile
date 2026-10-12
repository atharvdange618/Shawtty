FROM manimcommunity/manim:latest

USER root
WORKDIR /app

# Install ffmpeg and curl
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --ignore-requires-python -r requirements.txt

# Copy service source code
COPY service/ /app/service/

# Create work directories with appropriate permissions
RUN mkdir -p /app/output /app/media /app/jobs && chown -R manimuser:manimuser /app

USER manimuser
EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "service.main:app", "--host", "0.0.0.0", "--port", "8000"]
