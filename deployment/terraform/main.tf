/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

terraform {
  required_version = ">= 1.3.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ------------------------------------------------------------------------------
# Runtime Service Account with Least Privilege
# ------------------------------------------------------------------------------
resource "google_service_account" "image_handler_sa" {
  account_id   = "sa-image-handler-runtime"
  display_name = "Cloud Run Serverless Image Handler Runtime Service Account"
  project      = var.project_id
}

# ------------------------------------------------------------------------------
# IAM Binding: Object Viewer role on all configured source GCS buckets
# ------------------------------------------------------------------------------
resource "google_storage_bucket_iam_member" "gcs_viewer" {
  for_each = toset(var.source_buckets)
  bucket   = each.key
  role     = "roles/storage.objectViewer"
  member   = "serviceAccount:${google_service_account.image_handler_sa.email}"
}

# ------------------------------------------------------------------------------
# Optional IAM Binding: Secret Accessor role if HMAC signature verification is enabled
# ------------------------------------------------------------------------------
resource "google_secret_manager_secret_iam_member" "secret_accessor" {
  count     = var.enable_signature == "Yes" && var.secret_key_name != "" ? 1 : 0
  secret_id = var.secret_key_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.image_handler_sa.email}"
  project   = var.project_id
}

# ------------------------------------------------------------------------------
# Cloud Run v2 Service (Multi-concurrency Serverless Container)
# ------------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "image_handler" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  project  = var.project_id

  template {
    service_account                  = google_service_account.image_handler_sa.email
    max_instance_request_concurrency = var.max_concurrency

    containers {
      image = var.container_image

      resources {
        limits = {
          cpu    = var.cloud_run_cpu
          memory = var.cloud_run_memory
        }
        cpu_idle = true
      }

      env {
        name  = "SOURCE_BUCKETS"
        value = join(",", var.source_buckets)
      }

      env {
        name  = "ENABLE_SIGNATURE"
        value = var.enable_signature
      }

      env {
        name  = "SECRET_KEY_NAME"
        value = var.secret_key_name
      }
    }
  }

  depends_on = [
    google_storage_bucket_iam_member.gcs_viewer
  ]
}

# ------------------------------------------------------------------------------
# IAM Binding: Allow public unauthenticated invocation (or Serverless NEG invoke)
# ------------------------------------------------------------------------------
resource "google_cloud_run_v2_service_iam_member" "invoker" {
  name     = google_cloud_run_v2_service.image_handler.name
  location = google_cloud_run_v2_service.image_handler.location
  project  = google_cloud_run_v2_service.image_handler.project
  role     = "roles/run.invoker"
  member   = "allUsers"
}
