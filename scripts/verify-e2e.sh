#!/usr/bin/env bash
#
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# ==============================================================================
# Runner Script for Automated E2E Verification Suite
# ==============================================================================

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SERVICE_URL=""
BUCKET=""
KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-url)
      SERVICE_URL="$2"
      shift 2
      ;;
    --service-url=*)
      SERVICE_URL="${1#*=}"
      shift
      ;;
    --bucket)
      BUCKET="$2"
      shift 2
      ;;
    --bucket=*)
      BUCKET="${1#*=}"
      shift
      ;;
    --key)
      KEY="$2"
      shift 2
      ;;
    --key=*)
      KEY="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --service-url URL   Target Cloud Run Service URL (or set SERVICE_URL env var)"
      echo "  --bucket BUCKET     Test GCS source bucket name (or set TEST_BUCKET env var)"
      echo "  --key KEY           Sample image object key in source bucket (default: sample.jpg)"
      echo "  -h, --help          Show help message"
      exit 0
      ;;
    *)
      echo -e "${RED}[ERROR] Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

if [[ -z "$SERVICE_URL" && -n "$ENV_SERVICE_URL" ]]; then
  SERVICE_URL="$ENV_SERVICE_URL"
elif [[ -z "$SERVICE_URL" ]]; then
  # Try querying gcloud if available
  if command -v gcloud &>/dev/null; then
    echo -e "${CYAN}[INFO] --service-url not specified. Attempting to fetch from gcloud...${NC}"
    SERVICE_URL=$(gcloud run services describe gcp-serverless-image-handler --region=asia-east1 --format='value(status.url)' 2>/dev/null || true)
  fi
fi

if [[ -z "$SERVICE_URL" ]]; then
  echo -e "${YELLOW}[WARNING] No SERVICE_URL specified and unable to query gcloud. Using default: http://localhost:8080${NC}"
  SERVICE_URL="http://localhost:8080"
fi

# Ensure Node and NPX are available
if ! command -v node &>/dev/null; then
  echo -e "${RED}[ERROR] Node.js is not installed or not in PATH. Required to run TypeScript E2E suite.${NC}"
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
REPO_ROOT=$(dirname "$SCRIPT_DIR")
TEST_FILE="${REPO_ROOT}/test/e2e/run-e2e.ts"

echo -e "${BOLD}${CYAN}[E2E RUNNER] Starting E2E verification test against: ${GREEN}${SERVICE_URL}${NC}"

# Run with npx -y tsx or ts-node
ARGS=("--service-url=${SERVICE_URL}")
if [[ -n "$BUCKET" ]]; then ARGS+=("--bucket=${BUCKET}"); fi
if [[ -n "$KEY" ]]; then ARGS+=("--key=${KEY}"); fi

if command -v npx &>/dev/null; then
  npx -y tsx "${TEST_FILE}" "${ARGS[@]}"
else
  node -r ts-node/register "${TEST_FILE}" "${ARGS[@]}"
fi
