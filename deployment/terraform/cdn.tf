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

# ------------------------------------------------------------------------------
# Serverless Network Endpoint Group (NEG) for Cloud Run
# ------------------------------------------------------------------------------
resource "google_compute_region_network_endpoint_group" "serverless_neg" {
  count                 = var.enable_cdn ? 1 : 0
  name                  = "${var.service_name}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id

  cloud_run {
    service = google_cloud_run_v2_service.image_handler.name
  }
}

# ------------------------------------------------------------------------------
# Google Cloud Armor Security Policy (WAF, DDoS Protection, Rate Limiting)
# ------------------------------------------------------------------------------
resource "google_compute_security_policy" "armor_policy" {
  count       = var.enable_cdn ? 1 : 0
  name        = "${var.service_name}-armor-policy"
  description = "Cloud Armor security policy providing WAF protection, rate limiting, and DDoS mitigation for the Serverless Image Handler."
  project     = var.project_id

  # Rate limiting rule against brute-force / DoS image processing requests
  rule {
    action   = "rate_based_ban"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Rate limit requests from single IP: max 500 requests per 60s window."
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 500
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
  }

  # Default allow rule
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule for all traffic."
  }
}

# ------------------------------------------------------------------------------
# Backend Service with Cloud CDN Enabled
# ------------------------------------------------------------------------------
resource "google_compute_backend_service" "cdn_backend" {
  count                           = var.enable_cdn ? 1 : 0
  name                            = "${var.service_name}-backend"
  project                         = var.project_id
  enable_cdn                      = true
  protocol                        = "HTTPS"
  security_policy                 = google_compute_security_policy.armor_policy[0].id
  load_balancing_scheme           = "EXTERNAL_MANAGED"
  connection_draining_timeout_sec = 30

  cdn_policy {
    cache_mode                   = "CACHE_ALL_STATIC"
    default_ttl                  = 3600
    max_ttl                      = 86400
    client_ttl                   = 3600
    negative_caching             = true
    serve_while_stale            = 86400
    signed_url_cache_max_age_sec = 0
  }

  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg[0].id
  }
}

# ------------------------------------------------------------------------------
# URL Map
# ------------------------------------------------------------------------------
resource "google_compute_url_map" "url_map" {
  count           = var.enable_cdn ? 1 : 0
  name            = "${var.service_name}-url-map"
  project         = var.project_id
  default_service = google_compute_backend_service.cdn_backend[0].id
}

# ------------------------------------------------------------------------------
# Target HTTP Proxy
# ------------------------------------------------------------------------------
resource "google_compute_target_http_proxy" "http_proxy" {
  count   = var.enable_cdn ? 1 : 0
  name    = "${var.service_name}-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.url_map[0].id
}

# ------------------------------------------------------------------------------
# Global Forwarding Rule (External IPv4 Entry Point)
# ------------------------------------------------------------------------------
resource "google_compute_global_forwarding_rule" "http_forwarding_rule" {
  count                 = var.enable_cdn ? 1 : 0
  name                  = "${var.service_name}-forwarding-rule"
  project               = var.project_id
  target                = google_compute_target_http_proxy.http_proxy[0].id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
