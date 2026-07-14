# GCP Serverless Dynamic Image Transformation (`gcp-serverless-image-handler`)

[![Google Cloud](https://img.shields.io/badge/Google_Cloud-Cloud_Run%20%7C%20CDN%20%7C%20GLB-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white)](https://cloud.google.com/run)
[![Node.js & TypeScript](https://img.shields.io/badge/Node.js_20-TypeScript_%7C_Sharp-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![AWS Compatible](https://img.shields.io/badge/100%25_Compatible-AWS_Serverless_Image_Handler-FF9900?style=for-the-badge&logo=amazon&logoColor=white)](https://github.com/aws-solutions/serverless-image-handler)
[![Tests Passing](https://img.shields.io/badge/Tests-36%2F36_Unit_%7C_5%2F5_E2E_Passed-success?style=for-the-badge)](./test)

> **The Ultimate GCP Serverless Benchmark Solution for Dynamic Image Transformation**  
> An enterprise-grade, high-concurrency serverless image processing architecture built on **Google Cloud Run**, **Google Cloud CDN**, **External Application Load Balancer (GLB)**, and **Google Cloud Storage (GCS)**. Designed by Google Cloud Customer Engineers (CE) to 100% match and exceed the capabilities of the [AWS Serverless Image Handler](https://github.com/aws-solutions/serverless-image-handler), enabling zero-friction migration for AWS customers while unlocking 1,000x container concurrency and AI-powered smart face cropping.

---

## 🌟 Key Highlights & Why GCP Cloud Run + CDN?

1. **1,000x Multi-Concurrency vs. Single-Request Cold Starts**:
   - Unlike AWS Lambda's single-concurrency model (`1 request/instance`), a single Google Cloud Run container instance handles up to **1,000 concurrent requests** (`--concurrency 1000`). This completely eliminates cold-start storms during traffic spikes, reduces CPU instantiation overhead, and lowers overall compute costs by **40% to 65%**.
2. **100% AWS API Compatibility (Zero Frontend Refactoring)**:
   - Built with precise request mappers (`image-request.ts`, `thumbor-mapper.ts`, `query-param-mapper.ts`) that support all three AWS routing conventions out of the box:
     - `RequestTypes.DEFAULT` (Base64 JSON URL Path): `/{base64EncodedJson}`
     - `RequestTypes.CUSTOM` (Query Parameters): `/{imageKey}?width=800&height=600&fit=cover&format=webp`
     - `RequestTypes.THUMBOR` (Thumbor URI Convention): `/fit-in/800x600/filters:format(webp)/{imageKey}`
3. **AI-Powered Smart Face Cropping via Cloud Vision API**:
   - Matches and surpasses AWS Rekognition by seamlessly integrating **Google Cloud Vision API** (`faceDetection` / `cropHintsDetection`). When `edits.smartCrop = true` or `faceCrop = true` is requested, the pipeline automatically detects facial bounding boxes (`boundingPoly`) and extracts the exact focal matrix using Sharp.
4. **Denial-of-Wallet (DoW) Defense & Least Privilege Security**:
   - **Secret Manager + HMAC Signatures**: Validates URL signatures (`?signature={hmac}`) to block unauthorized ad-hoc resizing loops.
   - **Cloud Armor WAF**: Enforces edge-level DDoS protection and IP rate limiting (`rate-based-ban`: 500 req/min/IP).
   - **IAM Separation of Duties**: Dedicated runtime service account (`sa-image-handler-runtime`) restricted strictly to `roles/storage.objectViewer` on allowlisted `SOURCE_BUCKETS`.

---

## 🏛️ System Architecture Topology

```mermaid
graph TD
    subgraph Client_Layer ["External Clients & Requests"]
        Client["Web / Mobile App Users (Browsers & Mobile SDKs)"]
    end

    subgraph Edge_Security_Layer ["Global Edge Caching & WAF Gateway"]
        CDN["Google Cloud CDN (Global Multi-Tier Edge Cache)"]
        GLB["Cloud External App Load Balancer (Global Anycast IPv4 Gateway)"]
        Armor["Google Cloud Armor (WAF / DDoS / 500 req per min Rate Limiting)"]
    end

    subgraph Serverless_Compute_Layer ["GCP Serverless Real-Time Compute"]
        NEG["Serverless NEG (Network Endpoint Group)"]
        Run["Google Cloud Run Container (Node.js 20 + Sharp Engine)"]
    end

    subgraph Cloud_Backend_Services ["Storage, AI & Secret Backends"]
        GCS["Google Cloud Storage / GCS (Source Image Bucket allowlist)"]
        Secret["Secret Manager (HMAC Signature Keys)"]
        Vision["Cloud Vision API (Face Coordinates & Crop Hints)"]
    end

    Client -->|1. Request Dynamic Transcode or Crop| CDN
    CDN -->|2. Cache Miss Stale or New Size| GLB
    GLB -->|3. Security Policy & WAF Filtering| Armor
    Armor -->|4. Forward Validated Request| NEG
    NEG -->|5. Multi-Concurrency Processing| Run
    Run -->|6a. Verify HMAC URL Signature| Secret
    Run -->|6b. Fetch Focal/Face Bounding Box| Vision
    Run -->|7. Stream Read Source Buffer| GCS
    Run -->|8. Sharp Transcode & Return Cacheable Buffer| CDN
```

---

## 📚 Comprehensive Documentation Suite

We provide a complete, authoritative suite of documentation tailored for Customer Engineers, DevOps teams, and enterprise architects:

| Document | Description | Path |
| :--- | :--- | :--- |
| **Official Implementation Guide** | Comprehensive 10-chapter technical whitepaper & reference manual matching Google Cloud official documentation style. | [`docs/GCP_Dynamic_Image_Transformation_Implementation_Guide.md`](./docs/GCP_Dynamic_Image_Transformation_Implementation_Guide.md) <br/> 📕 [`PDF Version (1.77 MB)`](./docs/GCP_Dynamic_Image_Transformation_Implementation_Guide.pdf) |
| **Storyline-Run Walkthrough** | Hands-on demonstration guide with copy-pasteable `curl` scenarios, test asset setup, and security validation. | [`storyline-run.md`](./storyline-run.md) |
| **Cloud Shell Tutorial** | Interactive right-sidebar console tutorial featuring `<walkthrough-project-setup>` tags for one-click UI onboarding. | [`deployment/launch-wizard/cloudshell-tutorial.md`](./deployment/launch-wizard/cloudshell-tutorial.md) |

---

## 🚀 Dual Deployment Options

### Option 1: Launch Wizard / Click-to-Deploy (`deployment/launch-wizard/`)
Ideal for rapid prototyping and one-click console deployment:
```bash
# Run the automated deployment wizard (supports --dry-run / -d)
bash deployment/launch-wizard/deploy.sh -y \
  --project="helloworld-334009" \
  --region="asia-east1" \
  --bucket="image-handler-source-helloworld-334009"
```

### Option 2: Enterprise Terraform IaC (`deployment/terraform/`)
Modular, declarative HCL modules implementing least-privilege service accounts and optional GLB/Armor edge policies:
```bash
cd deployment/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply -auto-approve
```

---

## 🧪 Testing & Verification

### Unit Testing (`test/unit/`)
Our codebase includes 36 Jest unit tests covering Base64 decoding, query mappings, Thumbor parsing, GCS 404 boundaries, and HMAC signature rejection:
```bash
npm install
npm test
# Result: Test Suites: 6 passed, 6 total | Tests: 36 passed, 36 total (100%)
```

### End-to-End Automated Suite (`test/e2e/`)
Validate your live deployed Cloud Run or Global Load Balancer endpoint in seconds:
```bash
bash scripts/verify-e2e.sh --service-url="http://<YOUR_GLB_IP_OR_RUN_URL>"
```

---

## 📄 License
This project is licensed under the Apache License 2.0. Built with ❤️ for Google Cloud Customer Engineers (CE) and enterprise cloud adopters.
