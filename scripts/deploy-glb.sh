#!/usr/bin/env bash
set -eo pipefail

PROJECT_ID="helloworld-334009"
REGION="asia-east1"
SERVICE_NAME="gcp-serverless-image-handler"
NEG_NAME="image-handler-neg"
ARMOR_POLICY="image-handler-armor-policy"
BACKEND_NAME="image-handler-backend"
URL_MAP_NAME="image-handler-url-map"
PROXY_NAME="image-handler-http-proxy"
RULE_NAME="image-handler-glb-rule"

echo "================================================================================"
echo "  Deploying Global Load Balancer (GLB) + Cloud CDN + Cloud Armor for ${SERVICE_NAME}"
echo "================================================================================"

# 1. Create Serverless NEG
if ! gcloud compute network-endpoint-groups describe ${NEG_NAME} --region=${REGION} --project=${PROJECT_ID} &>/dev/null; then
  echo "[INFO] Creating Serverless NEG [${NEG_NAME}] in region [${REGION}] pointing to Cloud Run service [${SERVICE_NAME}]..."
  gcloud compute network-endpoint-groups create ${NEG_NAME} \
    --region=${REGION} \
    --network-endpoint-type=serverless \
    --cloud-run-service=${SERVICE_NAME} \
    --project=${PROJECT_ID}
else
  echo "[INFO] Serverless NEG [${NEG_NAME}] already exists."
fi

# 2. Create Cloud Armor security policy
if ! gcloud compute security-policies describe ${ARMOR_POLICY} --project=${PROJECT_ID} &>/dev/null; then
  echo "[INFO] Creating Cloud Armor security policy [${ARMOR_POLICY}]..."
  gcloud compute security-policies create ${ARMOR_POLICY} \
    --description="Cloud Armor WAF policy for ${SERVICE_NAME}" \
    --project=${PROJECT_ID}

  echo "[INFO] Adding rate-limiting rule (500 req/min/IP) to Cloud Armor policy..."
  gcloud compute security-policies rules create 100 \
    --security-policy=${ARMOR_POLICY} \
    --description="Rate limit rule: 500 req per minute per IP" \
    --src-ip-ranges="0.0.0.0/0" \
    --action=rate-based-ban \
    --rate-limit-threshold-count=500 \
    --rate-limit-threshold-interval-sec=60 \
    --ban-duration-sec=300 \
    --conform-action=allow \
    --exceed-action=deny-429 \
    --project=${PROJECT_ID}
else
  echo "[INFO] Cloud Armor security policy [${ARMOR_POLICY}] already exists."
fi

# 3. Create Backend Service with Cloud CDN enabled
if ! gcloud compute backend-services describe ${BACKEND_NAME} --global --project=${PROJECT_ID} &>/dev/null; then
  echo "[INFO] Creating global Backend Service [${BACKEND_NAME}] with Cloud CDN enabled..."
  gcloud compute backend-services create ${BACKEND_NAME} \
    --global \
    --enable-cdn \
    --cache-mode=USE_ORIGIN_HEADERS \
    --project=${PROJECT_ID}

  echo "[INFO] Attaching Cloud Armor security policy [${ARMOR_POLICY}] to backend service [${BACKEND_NAME}]..."
  gcloud compute backend-services update ${BACKEND_NAME} \
    --global \
    --security-policy=${ARMOR_POLICY} \
    --project=${PROJECT_ID}

  echo "[INFO] Adding Serverless NEG [${NEG_NAME}] to backend service [${BACKEND_NAME}]..."
  gcloud compute backend-services add-backend ${BACKEND_NAME} \
    --global \
    --network-endpoint-group=${NEG_NAME} \
    --network-endpoint-group-region=${REGION} \
    --project=${PROJECT_ID}
else
  echo "[INFO] Backend Service [${BACKEND_NAME}] already exists."
  gcloud compute backend-services update ${BACKEND_NAME} \
    --global \
    --security-policy=${ARMOR_POLICY} \
    --project=${PROJECT_ID} || true
fi

# 4. Create URL Map
if ! gcloud compute url-maps describe ${URL_MAP_NAME} --project=${PROJECT_ID} &>/dev/null; then
  echo "[INFO] Creating URL Map [${URL_MAP_NAME}]..."
  gcloud compute url-maps create ${URL_MAP_NAME} \
    --default-service=${BACKEND_NAME} \
    --project=${PROJECT_ID}
else
  echo "[INFO] URL Map [${URL_MAP_NAME}] already exists."
fi

# 5. Create Target HTTP Proxy
if ! gcloud compute target-http-proxies describe ${PROXY_NAME} --project=${PROJECT_ID} &>/dev/null; then
  echo "[INFO] Creating Target HTTP Proxy [${PROXY_NAME}]..."
  gcloud compute target-http-proxies create ${PROXY_NAME} \
    --url-map=${URL_MAP_NAME} \
    --project=${PROJECT_ID}
else
  echo "[INFO] Target HTTP Proxy [${PROXY_NAME}] already exists."
fi

# 6. Create Global Forwarding Rule
if ! gcloud compute forwarding-rules describe ${RULE_NAME} --global --project=${PROJECT_ID} &>/dev/null; then
  echo "[INFO] Creating Global Forwarding Rule [${RULE_NAME}] on port 80..."
  gcloud compute forwarding-rules create ${RULE_NAME} \
    --global \
    --target-http-proxy=${PROXY_NAME} \
    --ports=80 \
    --project=${PROJECT_ID}
else
  echo "[INFO] Global Forwarding Rule [${RULE_NAME}] already exists."
fi

# 7. Get and display GLB IP Address
GLB_IP=$(gcloud compute forwarding-rules describe ${RULE_NAME} --global --project=${PROJECT_ID} --format="value(IPAddress)")

echo "================================================================================"
echo "  GLB Deployment Complete!"
echo "================================================================================"
echo "  Global Load Balancer IP: http://${GLB_IP}"
echo "  Backend Serverless NEG:  ${NEG_NAME} -> ${SERVICE_NAME} (${REGION})"
echo "  Cloud CDN Enabled:       Yes (USE_ORIGIN_HEADERS)"
echo "  Cloud Armor WAF Applied: ${ARMOR_POLICY} (Rate limit: 500 req/min)"
echo "================================================================================"
