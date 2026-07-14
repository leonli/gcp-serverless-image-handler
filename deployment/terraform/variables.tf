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

variable "project_id" {
  type        = string
  description = "The GCP project ID to deploy the serverless image handler resources into."
}

variable "region" {
  type        = string
  description = "The GCP region for deploying Cloud Run and the Serverless Network Endpoint Group (NEG)."
  default     = "asia-east1"
}

variable "service_name" {
  type        = string
  description = "The name of the Cloud Run v2 service and prefix for related resources."
  default     = "gcp-serverless-image-handler"
}

variable "container_image" {
  type        = string
  description = "The container image URI (e.g. gcr.io/project-id/image-handler:latest) for the Cloud Run service."
}

variable "source_buckets" {
  type        = list(string)
  description = "List of Google Cloud Storage bucket names containing source images."
}

variable "enable_signature" {
  type        = string
  description = "Whether to enable HMAC signature verification on incoming image transformation requests ('Yes' or 'No')."
  default     = "No"

  validation {
    condition     = contains(["Yes", "No"], var.enable_signature)
    error_message = "The enable_signature variable must be either 'Yes' or 'No'."
  }
}

variable "secret_key_name" {
  type        = string
  description = "The Secret Manager secret ID/name containing the HMAC secret key when enable_signature is 'Yes'."
  default     = ""
}

variable "enable_cdn" {
  type        = bool
  description = "Whether to deploy Google Cloud CDN, Serverless NEG, External Application Load Balancer, and Cloud Armor WAF in front of Cloud Run."
  default     = true
}

variable "cloud_run_cpu" {
  type        = string
  description = "CPU allocation for each Cloud Run instance (e.g. '2000m' or '2')."
  default     = "2000m"
}

variable "cloud_run_memory" {
  type        = string
  description = "Memory limit for each Cloud Run instance (e.g. '2048Mi' or '2Gi')."
  default     = "2048Mi"
}

variable "max_concurrency" {
  type        = number
  description = "Maximum number of concurrent requests handled by each Cloud Run container instance."
  default     = 1000
}
