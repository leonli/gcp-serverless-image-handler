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

output "cloud_run_service_url" {
  description = "The direct HTTPS endpoint URL of the deployed Cloud Run service."
  value       = google_cloud_run_v2_service.image_handler.uri
}

output "load_balancer_ip" {
  description = "The external IPv4 address of the Global External Application Load Balancer with Cloud CDN enabled."
  value       = var.enable_cdn ? google_compute_global_forwarding_rule.http_forwarding_rule[0].ip_address : null
}

output "runtime_service_account_email" {
  description = "The email address of the dedicated runtime service account assigned to the Cloud Run service."
  value       = google_service_account.image_handler_sa.email
}
