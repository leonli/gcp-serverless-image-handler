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
# GCP Serverless Image Handler - Interactive / CLI Automated Deployment Script
# ==============================================================================

set -eo pipefail

# ANSI Color Codes for robust terminal styling
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default values
SERVICE_NAME="gcp-serverless-image-handler"
DRY_RUN=false
AUTO_APPROVE=false
PROJECT_ID=""
REGION="asia-east1"
BUCKET=""
SOURCE_BUCKETS=""
ENABLE_SIGNATURE="No"
SECRET_KEY_NAME=""
AUTO_ENABLE_CDN=true

# Helper functions for structured output
print_header() {
  echo -e "\n${BOLD}${BLUE}================================================================================${NC}"
  echo -e "${BOLD}${CYAN}  $1${NC}"
  echo -e "${BOLD}${BLUE}================================================================================${NC}"
}

print_info() {
  echo -e "${CYAN}[INFO]${NC} $1"
}

print_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Parse command line flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dry-run)
      DRY_RUN=true
      shift
      ;;
    -y|--auto-approve)
      AUTO_APPROVE=true
      shift
      ;;
    --project)
      PROJECT_ID="$2"
      shift 2
      ;;
    --project=*)
      PROJECT_ID="${1#*=}"
      shift
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --region=*)
      REGION="${1#*=}"
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
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  -d, --dry-run        Run in simulation mode without creating/modifying resources"
      echo "  -y, --auto-approve   Automatically approve interactive prompts"
      echo "  --project PROJECT    Target GCP Project ID"
      echo "  --region REGION      GCP Region for Cloud Run deployment (default: asia-east1)"
      echo "  --bucket BUCKET      Primary GCS source bucket name for original images"
      echo "  -h, --help           Show this help message and exit"
      exit 0
      ;;
    *)
      print_error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

print_header "GCP Serverless Image Handler - Automated Deployment Wizard"

INTERACTIVE=true
if [[ "$DRY_RUN" == true || "$AUTO_APPROVE" == true || ! -t 0 ]]; then
  INTERACTIVE=false
fi

if [[ "$DRY_RUN" == true ]]; then
  print_warning "RUNNING IN DRY-RUN MODE (--dry-run). No actual resources will be created or modified."
fi

# ------------------------------------------------------------------------------
# 1. Pre-flight Checks: gcloud, docker / Cloud Build, and environment setup
# ------------------------------------------------------------------------------
print_info "Running pre-flight checks..."

if ! command -v gcloud &> /dev/null; then
  print_error "Google Cloud SDK (gcloud) is not installed or not in PATH. Please install gcloud CLI first."
  exit 1
fi
print_success "gcloud CLI detected: $(gcloud --version | head -n1)"

# Check docker or cloudbuild capability
if command -v docker &> /dev/null; then
  print_success "docker CLI detected: $(docker --version)"
else
  print_info "docker CLI not found locally. Will utilize Google Cloud Build (gcloud builds submit) for remote container building."
fi

# Determine PROJECT_ID if not explicitly provided via flag
if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
  if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
    if [[ "$INTERACTIVE" == false ]]; then
      print_error "PROJECT_ID is not set and non-interactive/dry-run mode is active. Please specify --project=<YOUR_PROJECT_ID>."
      exit 1
    fi
    read -r -p "Enter your Google Cloud Project ID: " PROJECT_ID
    if [[ -z "$PROJECT_ID" ]]; then
      print_error "Project ID cannot be empty."
      exit 1
    fi
  fi
fi
print_info "Target GCP Project ID: ${BOLD}${PROJECT_ID}${NC}"
print_info "Target GCP Region:     ${BOLD}${REGION}${NC}"

# Set working project in gcloud
if [[ "$DRY_RUN" == false ]]; then
  gcloud config set project "${PROJECT_ID}" --quiet >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------------------
# 2. Required APIs Check & Auto-enable
# ------------------------------------------------------------------------------
print_info "Checking required Google Cloud APIs..."
REQUIRED_APIS=(
  "run.googleapis.com"
  "storage.googleapis.com"
  "vision.googleapis.com"
  "secretmanager.googleapis.com"
  "cloudbuild.googleapis.com"
)

if [[ "$DRY_RUN" == true ]]; then
  print_info "[DRY-RUN] Would verify and auto-enable the following APIs:"
  for api in "${REQUIRED_APIS[@]}"; do
    echo -e "  - ${CYAN}${api}${NC}"
  done
else
  for api in "${REQUIRED_APIS[@]}"; do
    # Check if enabled
    if gcloud services list --enabled --project="${PROJECT_ID}" --format="value(config.name)" 2>/dev/null | grep -q "^${api}$"; then
      print_success "API [${api}] is already enabled."
    else
      print_warning "API [${api}] is not enabled. Enabling now..."
      gcloud services enable "${api}" --project="${PROJECT_ID}" --quiet
      print_success "API [${api}] enabled successfully."
    fi
  done
fi

# ------------------------------------------------------------------------------
# 3. Interactive Prompts / Environment Fallbacks
# ------------------------------------------------------------------------------
print_info "Configuring runtime environment parameters..."

# Resolve SOURCE_BUCKETS
if [[ -n "$BUCKET" ]]; then
  SOURCE_BUCKETS="$BUCKET"
elif [[ -n "${ENV_SOURCE_BUCKETS}" ]]; then
  SOURCE_BUCKETS="${ENV_SOURCE_BUCKETS}"
else
  DEFAULT_BUCKET="image-handler-source-${PROJECT_ID}"
  if [[ "$INTERACTIVE" == false ]]; then
    SOURCE_BUCKETS="$DEFAULT_BUCKET"
  else
    read -r -p "Enter comma-separated GCS source bucket name(s) [default: ${DEFAULT_BUCKET}]: " USER_INPUT_BUCKETS
    SOURCE_BUCKETS="${USER_INPUT_BUCKETS:-$DEFAULT_BUCKET}"
  fi
fi

# Resolve ENABLE_SIGNATURE
if [[ -z "${ENABLE_SIGNATURE}" || "$INTERACTIVE" == false ]]; then
  if [[ "$INTERACTIVE" == false ]]; then
    ENABLE_SIGNATURE="${ENABLE_SIGNATURE:-No}"
  else
    read -r -p "Enable HMAC signature verification for requests? (Yes/No) [default: No]: " USER_SIG
    ENABLE_SIGNATURE="${USER_SIG:-No}"
  fi
fi

# Resolve SECRET_KEY_NAME if ENABLE_SIGNATURE == Yes
if [[ "$ENABLE_SIGNATURE" == "Yes" || "$ENABLE_SIGNATURE" == "yes" || "$ENABLE_SIGNATURE" == "YES" ]]; then
  ENABLE_SIGNATURE="Yes"
  if [[ -z "${SECRET_KEY_NAME}" && "$INTERACTIVE" == false ]]; then
    SECRET_KEY_NAME="image-handler-hmac-secret"
  elif [[ -z "${SECRET_KEY_NAME}" ]]; then
    read -r -p "Enter Secret Manager secret ID/name for HMAC key: " SECRET_KEY_NAME
  fi
  if [[ -z "${SECRET_KEY_NAME}" ]]; then
    SECRET_KEY_NAME="image-handler-hmac-secret"
    print_warning "SECRET_KEY_NAME not provided, defaulting to: ${SECRET_KEY_NAME}"
  fi
else
  ENABLE_SIGNATURE="No"
  SECRET_KEY_NAME=""
fi

# Resolve AUTO_ENABLE_CDN
if [[ "$INTERACTIVE" == false ]]; then
  AUTO_ENABLE_CDN="${AUTO_ENABLE_CDN:-true}"
else
  read -r -p "Deploy Cloud CDN / External Load Balancer via Terraform guidance? (true/false) [default: true]: " USER_CDN
  AUTO_ENABLE_CDN="${USER_CDN:-true}"
fi

print_header "Configuration Summary"
echo -e "  Project ID:        ${BOLD}${CYAN}${PROJECT_ID}${NC}"
echo -e "  Region:            ${BOLD}${CYAN}${REGION}${NC}"
echo -e "  Service Name:      ${BOLD}${CYAN}${SERVICE_NAME}${NC}"
echo -e "  Source Buckets:    ${BOLD}${GREEN}${SOURCE_BUCKETS}${NC}"
echo -e "  Enable Signature:  ${BOLD}${YELLOW}${ENABLE_SIGNATURE}${NC}"
echo -e "  Secret Key Name:   ${BOLD}${YELLOW}${SECRET_KEY_NAME:-N/A}${NC}"
echo -e "  Auto Enable CDN:   ${BOLD}${CYAN}${AUTO_ENABLE_CDN}${NC}"
echo -e "  Dry Run Mode:      ${BOLD}${RED}${DRY_RUN}${NC}"
echo -e "${BOLD}${BLUE}================================================================================${NC}"

if [[ "$INTERACTIVE" == true ]]; then
  read -r -p "Proceed with deployment? (y/N): " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    print_warning "Deployment cancelled by user."
    exit 0
  fi
fi

# ------------------------------------------------------------------------------
# 4. Automatic Creation of GCS Source Buckets
# ------------------------------------------------------------------------------
print_info "Ensuring GCS source bucket(s) exist..."
IFS=',' read -ra BUCKET_ARRAY <<< "$SOURCE_BUCKETS"

for b in "${BUCKET_ARRAY[@]}"; do
  # Trim spaces
  clean_bucket=$(echo "$b" | xargs)
  if [[ -z "$clean_bucket" ]]; then continue; fi

  if [[ "$DRY_RUN" == true ]]; then
    print_info "[DRY-RUN] Would check and create GCS bucket if not existing:"
    echo -e "  -> ${GREEN}gcloud storage buckets create gs://${clean_bucket} --location=${REGION} --project=${PROJECT_ID}${NC}"
  else
    if gcloud storage buckets describe "gs://${clean_bucket}" --project="${PROJECT_ID}" &>/dev/null; then
      print_success "Bucket [gs://${clean_bucket}] already exists."
    else
      print_warning "Bucket [gs://${clean_bucket}] does not exist. Creating now..."
      gcloud storage buckets create "gs://${clean_bucket}" --location="${REGION}" --project="${PROJECT_ID}" --quiet
      print_success "Created bucket [gs://${clean_bucket}] in region ${REGION}."
    fi
  fi
done

# ------------------------------------------------------------------------------
# 5. Build and Deploy Cloud Run Service
# ------------------------------------------------------------------------------
CONTAINER_IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"

print_header "Container Build & Cloud Run Deployment"

if [[ "$DRY_RUN" == true ]]; then
  print_warning "DRY-RUN EXECUTION PLAN:"
  echo -e "\n${BOLD}Step 1: Container Build Command (Cloud Build):${NC}"
  echo -e "${CYAN}gcloud builds submit --tag ${CONTAINER_IMAGE} --project ${PROJECT_ID} .${NC}"

  echo -e "\n${BOLD}Step 2: Cloud Run Deploy Command:${NC}"
  echo -e "${CYAN}gcloud run deploy ${SERVICE_NAME} \\
  --image ${CONTAINER_IMAGE} \\
  --region ${REGION} \\
  --project ${PROJECT_ID} \\
  --set-env-vars SOURCE_BUCKETS=${SOURCE_BUCKETS},ENABLE_SIGNATURE=${ENABLE_SIGNATURE},SECRET_KEY_NAME=${SECRET_KEY_NAME} \\
  --concurrency 1000 \\
  --cpu 2 \\
  --memory 2048Mi \\
  --allow-unauthenticated${NC}"

  echo -e "\n${BOLD}Step 3: Architecture Overview:${NC}"
  echo -e "  Cloud CDN / Load Balancer (when enabled via Terraform) -> Serverless NEG -> Cloud Run (${SERVICE_NAME}) -> GCS (${SOURCE_BUCKETS})"
  print_success "Dry-run completed successfully! Pre-checks passed."
  exit 0
fi

# Actual Build
print_info "Submitting container build to Google Cloud Build..."
gcloud builds submit --tag "${CONTAINER_IMAGE}" --project "${PROJECT_ID}" --quiet .
print_success "Container image built and pushed to: ${CONTAINER_IMAGE}"

# Actual Deploy
print_info "Deploying service [${SERVICE_NAME}] to Cloud Run in region [${REGION}]..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${CONTAINER_IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --set-env-vars "SOURCE_BUCKETS=${SOURCE_BUCKETS},ENABLE_SIGNATURE=${ENABLE_SIGNATURE},SECRET_KEY_NAME=${SECRET_KEY_NAME}" \
  --concurrency 1000 \
  --cpu 2 \
  --memory 2048Mi \
  --allow-unauthenticated \
  --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true)

print_header "Deployment Complete!"
print_success "Cloud Run Service [${SERVICE_NAME}] is live!"
if [[ -n "${SERVICE_URL}" ]]; then
  echo -e "  Public Service URL: ${BOLD}${GREEN}${SERVICE_URL}${NC}"
fi
echo -e "\nTo run automated E2E verification tests against this endpoint, execute:"
echo -e "  ${CYAN}bash scripts/verify-e2e.sh --service-url=\"${SERVICE_URL}\"${NC}"
echo -e "${BOLD}${BLUE}================================================================================${NC}\n"
