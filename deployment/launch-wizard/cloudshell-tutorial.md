# GCP Serverless Image Handler 控制台一键向导教程

## 欢迎使用 GCP Serverless Image Handler 一键部署向导
<walkthrough-tutorial-duration duration="15"></walkthrough-tutorial-duration>

本向导将指引您在 Google Cloud Shell 中快速、零运维地开通并部署完整对标 AWS CloudFront + `serverless-image-handler` 的企业级高并发实时动态图片处理服务（基于 **Cloud Run Container + Cloud CDN + Cloud Storage + Cloud Vision API**）。

### 核心特性对标优势：
- **高并发零冷启动**：单一 Cloud Run 容器实例默认支持多达 **1,000 个并发请求**，结合 Node.js 20 与 Sharp 极速 C++ 渲染引擎，提供毫秒级 P99 延迟。
- **100% 接口零改造迁移**：完整兼容 Base64 (`RequestTypes.DEFAULT`)、URL Query 参数 (`RequestTypes.CUSTOM`) 与 Thumbor (`RequestTypes.THUMBOR`) 三大接口规范。
- **安全与合规防御**：支持 HMAC URL 防篡改签名校验与 Cloud Armor WAF / Rate Limiting 边缘限流。

点击右下角的 **开始 (Start)** 开启您的部署之旅！

---

## 1. 环境准备与项目选择

首先，确保您的 Cloud Shell 会话关联到正确的 Google Cloud 项目。

### 选择当前项目
请选择或确认您要部署的目标项目 ID：
<walkthrough-project-setup></walkthrough-project-setup>

设置并确认当前激活的 GCP 项目：
```bash
export PROJECT_ID=$(gcloud config get-value project)
echo "当前部署项目 ID: ${PROJECT_ID}"
```

设置默认的部署区域（如 `asia-east1` 或 `us-central1`）：
```bash
export REGION="asia-east1"
gcloud config set run/region ${REGION}
```

---

## 2. 预检与模拟演练 (Dry-Run 模式)

为确保当前环境的 API 开通状态和配置参数无误，且不产生任何实际云端资源计费与修改，我们可以先使用本方案提供的自动部署脚本进行 **Dry-Run 预检与模拟演练**。

运行以下命令执行 Dry-Run 测试：
```bash
bash deployment/launch-wizard/deploy.sh --dry-run \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --bucket="image-handler-source-${PROJECT_ID}"
```

您将看到脚本自动完成如下检查与输出：
1. **预检 Google Cloud SDK (`gcloud`)** 是否就绪。
2. **检测并验证必要的云端 API** (`run.googleapis.com`, `storage.googleapis.com`, `vision.googleapis.com`, `secretmanager.googleapis.com`, `cloudbuild.googleapis.com`) 是否处于 ENABLED 状态。
3. **输出即将执行的架构设计、GCS 存储桶创建指令、Docker 构建指令及 Cloud Run 部署参数。**

---

## 3. 一键正式自动化部署

在 Dry-Run 预检通过后，现在可以执行正式部署。脚本将交互式引导您或自动根据命令行参数完成资源初始化。

执行自动化构建与发布脚本：
```bash
bash deployment/launch-wizard/deploy.sh \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --bucket="image-handler-source-${PROJECT_ID}" \
  --auto-approve
```

### 自动化构建流程详解：
1. **自动创建或校验 GCS 源图片存储桶**：若 `gs://image-handler-source-${PROJECT_ID}` 不存在，自动为您创建。
2. **提交 Cloud Build 构建多阶段容器镜像**：精简版 Dockerfile 基于 `node:20-slim` 构建，打包 Sharp 内核并上传至 `gcr.io/${PROJECT_ID}/gcp-serverless-image-handler:latest`。
3. **极速发布 Cloud Run 服务**：配置 `max-concurrency = 1000`、内存 2048Mi、CPU 2.0，绑定环境参数 `SOURCE_BUCKETS`，并开放 `allUsers` 访问或 Serverless NEG 对接。

---

## 4. 自动化回归测试与端到端 (E2E) 验证

部署完成后，脚本将在终端打印出 Cloud Run 的服务公网访问端点（`SERVICE_URL`）。我们可以直接运行自动化 E2E 校验测试脚本来验证四大能力：

### 获取服务 URL 并配置测试环境变量
```bash
export SERVICE_URL=$(gcloud run services describe gcp-serverless-image-handler --region=${REGION} --format='value(status.url)')
echo "服务端点 URL: ${SERVICE_URL}"
```

### 运行自动化测试套件
我们集成了完整对标 AWS `serverless-image-handler` 规范的 TypeScript E2E 测试脚本，自动校验：
- **健康检查** (`GET /health`) 200 OK 响应状态。
- **Base64 JSON 路由** (`RequestTypes.DEFAULT`) 图片裁剪与 WebP 自动压缩转码。
- **Query Parameter 路由** (`RequestTypes.CUSTOM`) 自定义参数调整与格式转换。
- **Thumbor 路由** (`RequestTypes.THUMBOR`) 路径语法支持。
- **HMAC 签名安全防御拦截** 非授权篡改请求立即返回 403 Forbidden。

执行一键回归验证：
```bash
bash scripts/verify-e2e.sh --service-url="${SERVICE_URL}"
```

---

## 5. 恭喜您完成部署与测试！

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

您已成功完成 **GCP Serverless Dynamic Image Transformation** 企业级双轨部署与自动化 E2E 验证！

### 后续建议：
- 如需启用全球边缘配置与 DDoS WAF 防护，请通过 **Terraform 模块 (`deployment/terraform/`)** 开通 Cloud CDN 与 Cloud Armor WAF。
- 您可以查看或修改 `terraform/terraform.tfvars` 实现后续的基础设施版本化管控 (IaC)。
