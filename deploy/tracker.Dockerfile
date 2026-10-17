# syntax=docker/dockerfile:1
#
# The plane tracker (its-a-plane-python, bundled in tracker/), headless, as the
# master tracker for the house. See tracker/UPSTREAM.md.
# Built from the repo root:  docker compose -f deploy/docker-compose.yml build tracker
ARG PYTHON_IMAGE=python:3.14-slim

FROM ${PYTHON_IMAGE} AS deps
COPY tracker/requirements.txt /tmp/requirements.txt
# Exact versions with hashes, wheels only (no build scripts run).
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      --require-hashes --only-binary=:all: --target /opt/tracker/site -r /tmp/requirements.txt

FROM ${PYTHON_IMAGE} AS runtime
ENV PYTHONPATH=/opt/tracker/site:/opt/tracker/headless \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/tracker/headless/bin:/opt/tracker/site/bin:/usr/local/bin:/usr/bin:/bin \
    TRACKER_CODE=/opt/tracker/app \
    TRACKER_DATA=/data/app \
    HOME=/tmp
COPY --from=deps /opt/tracker/site /opt/tracker/site
COPY tracker/app /opt/tracker/app
COPY tracker/headless /opt/tracker/headless
# Code is root-owned and read-only; the tracker's state goes to /data.
RUN chmod -R a-w /opt/tracker \
 && python -c "import flask, PIL, folium, ephem, requests, rgbmatrix; print('tracker deps ok')"
USER 10001:10001
WORKDIR /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/usage', timeout=4)"]
CMD ["python", "/opt/tracker/headless/homebase_run.py"]
