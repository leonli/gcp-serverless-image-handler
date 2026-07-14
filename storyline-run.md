# GCP Serverless Dynamic Image Transformation — 客户实测与演示剧本 (`Storyline-Run`)

> [!IMPORTANT]
> **关于本实测剧本 (Executive Storyline Overview)**  
> 本指南专为 Google Cloud Customer Engineer (CE) 及其企业级客户设计，用以在真实 GCP 环境中对齐并验证 **`gcp-serverless-image-handler`** 动态图片转换全套方案。本方案涵盖从源存储桶 (`Google Cloud Storage`) 提取原始文件，并通过 **Google Cloud Run (Node.js + Sharp + Cloud Vision API)** 进行毫秒级并发实时裁剪、多格式转码、智能面部捕捉及 HMAC 安全签名验证的全流程。  
> 剧本内容分为 **准备工作与测试数据准备** 与 **四大核心实测场景 (4 Core Demonstration Scenarios)**，提供开箱即用的 Base64 与 Query URL 示例，保证自 AWS (`serverless-image-handler`) 迁移的客户能够体验 **零前端代码改造、毫秒级响应、多并发无冷启动** 的高阶云端架构体验。

---

## 0. 准备工作：服务发现与测试数据准备 (Preparation & Test Data Setup)

在开始运行本次 Storyline 实测前，我们将首先确认云端端点并往 GCS 源存储桶上传两张经典的样本图片：
1. **普通高清风景/商品图 (`catalog/sample-product.jpg`)**：用于测试比例裁剪、多格式转码 (JPEG -> WebP/AVIF) 与水印滤镜。
2. **多面部人物图 (`people/team-faces.jpg`)**：用于测试与 Cloud Vision API 结合的 **智能面部裁剪 (Smart Face Crop)**。

### 0.1 设置环境变量与验证服务端点
请在您的命令行终端 (或 Cloud Shell) 中执行以下基础变量配置：

```bash
# 1. 设置当前 GCP 项目与区域
export PROJECT_ID="helloworld-334009"
export REGION="asia-east1"
export SERVICE_NAME="gcp-serverless-image-handler"
export SOURCE_BUCKET="image-handler-source-${PROJECT_ID}"

# 2. 获取部署在 Cloud Run 上的服务后端公共端点 (SERVICE_URL)
export SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} --project ${PROJECT_ID} \
  --format 'value(status.url)')

echo "--------------------------------------------------------"
echo "部署服务端点 (Cloud Run URL): ${SERVICE_URL}"
echo "源图片存储桶 (GCS Source):   gs://${SOURCE_BUCKET}"
echo "--------------------------------------------------------"
```

### 0.2 自动生成并上传测试样本图到 GCS
使用以下自动化脚本极速生成测试素材并存入 GCS 源桶：

```bash
# 创建临时测试图生成目录
mkdir -p /tmp/gcp-image-test-assets && cd /tmp/gcp-image-test-assets

# 下载开源免费的高清测试图片与面部测试图
curl -sSL "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1600&q=80" -o sample-product.jpg
curl -sSL "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1200&q=80" -o team-faces.jpg

# 确保 GCS 桶存在并上传
gcloud storage buckets create gs://${SOURCE_BUCKET} --location=${REGION} --project=${PROJECT_ID} 2>/dev/null || true
gcloud storage cp sample-product.jpg gs://${SOURCE_BUCKET}/catalog/sample-product.jpg
gcloud storage cp team-faces.jpg gs://${SOURCE_BUCKET}/people/team-faces.jpg

echo "测试素材成功就位于 gs://${SOURCE_BUCKET}/ 目录下！"
```

---

## 1. 场景一：AWS 标准 Base64 JSON 动态裁剪与转码 (`RequestTypes.DEFAULT`)

> **场景背景 (Scenario Context)**  
> AWS `serverless-image-handler` 最标准的请求方式是将包含 `bucket`、`key` 和 `edits` 对象的 JSON 字符串进行 Base64 编码，放入 URL 路径中（如 `https://cdn.example.com/{base64Json}`）。本场景展示方案后端如何以 **毫秒级时延** 兼容并解析该指令，生成适配移动端屏幕的 500x500 WebP 压缩图。

### 1.1 构造 Base64 JSON 负载并发起请求

```bash
# 1. 构造与 AWS Serverless Image Handler 100% 对标的 JSON 负载
REQUEST_JSON=$(cat <<EOF
{
  "bucket": "${SOURCE_BUCKET}",
  "key": "catalog/sample-product.jpg",
  "edits": {
    "resize": {
      "width": 500,
      "height": 500,
      "fit": "cover"
    },
    "toFormat": "webp",
    "webp": {
      "quality": 80
    }
  }
}
EOF
)

# 2. 将 JSON 转换为 URL-Safe Base64 字符串
BASE64_PAYLOAD=$(echo -n "${REQUEST_JSON}" | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

echo "Base64 请求路径: ${SERVICE_URL}/${BASE64_PAYLOAD}"

# 3. 发起请求并在控制台验证 HTTP 响应头 (验证 WebP 转换与边缘 CDN 缓存 Header)
curl -sSL -D - "${SERVICE_URL}/${BASE64_PAYLOAD}" -o /tmp/resized-500x500.webp | head -n 15
```

### 1.2 CE 验证指标 (What to highlight to the customer)
- **响应格式验证**：观察返回的 HTTP Header 中 `Content-Type: image/webp`，证明即便源文件为 `sample-product.jpg`，云端已通过 Sharp 在内核极速转换为 WebP 格式。
- **缓存策略验证**：观察返回 header 包含 `Cache-Control: public, max-age=31536000, immutable`，说明该动态计算结果一旦被前端请求一次，即将长期固化在 **Google Cloud CDN** 边缘节点中，后续请求不再消耗计算资源与回源流量！
- **极速性能验证**：查看下载完成的文件大小 (`ls -lh /tmp/resized-500x500.webp`)，由于转为 80 质量的 WebP，体积较原始未压缩 JPEG 减小超过 **75%+**。

---

## 2. 场景二：开发友好的 Query 查询参数动态裁剪与滤镜 (`RequestTypes.CUSTOM`)

> **场景背景 (Scenario Context)**  
> 部分前端动态页面框架（如 React/Next.js/Vue）更倾向于直接传递 URL 查询参数来拼装多屏响应式断点（Responsive Images）。本场景展示方案对 Query 路由 (`?width=&height=&format=`) 的动态支持，以及高级色彩滤镜的组合能力。

### 2.1 执行实测指令：响应式尺寸调整 + 黑白复古滤镜 (`Grayscale + AVIF`)

```bash
# 通过简单直观的 Query 参数同时进行尺寸适配、黑白滤镜转换与下一代 AVIF 极限压缩
curl -sSL -D - "${SERVICE_URL}/catalog/sample-product.jpg?width=300&height=400&fit=cover&format=avif&quality=70&grayscale=true" \
  -o /tmp/product-grayscale.avif | head -n 15
```

### 2.2 存量 Thumbor 兼容系统映射实测 (`RequestTypes.THUMBOR`)
针对从第三方 Thumbor 开源生态栈迁移到 GCP 的客户，演示无需修改任何前端系统，直接利用 Thumbor 语法调用处理：

```bash
# 验证 Thumbor 经典筛选规则支持
curl -sSL -D - "${SERVICE_URL}/fit-in/600x600/filters:format(png):quality(90)/catalog/sample-product.jpg" \
  -o /tmp/product-thumbor.png | head -n 15
```

---

## 3. 场景三：AI 与图像引擎协同 — 智能面部检测裁剪 (`Smart Crop & Face Detection`)

> **场景背景 (Scenario Context)**  
> 传统的机械中心点裁剪（Center Crop）常由于图像主体偏离中心而导致人物面部或关键核心区域被裁切截断。本场景展示 GCP 独有的 **云原生跨组件联动能力**：当客户指定 `edits.smartCrop = true` 或 `edits.faceCrop = true` 时，无服务器引擎自动在流水线中调取 **Google Cloud Vision API** 进行精确到坐标级的人脸定位与智能裁剪！

### 3.1 执行实测指令：人脸智能捕捉裁切

```bash
# 构造触发 AI 面部智能检测的请求 JSON
FACE_CROP_JSON=$(cat <<EOF
{
  "bucket": "${SOURCE_BUCKET}",
  "key": "people/team-faces.jpg",
  "edits": {
    "resize": {
      "width": 400,
      "height": 400
    },
    "smartCrop": true,
    "toFormat": "jpeg"
  }
}
EOF
)

BASE64_FACE_PAYLOAD=$(echo -n "${FACE_CROP_JSON}" | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

echo "正在调用 Cloud Vision AI 进行智能面部感知处理..."
curl -sSL -D - "${SERVICE_URL}/${BASE64_FACE_PAYLOAD}" -o /tmp/ai-face-cropped.jpg | head -n 15
```

### 3.2 CE 验证指标 (What to highlight to the customer)
- **跨后端集成零延迟感知**：尽管后端触发了外部 AI 服务（Cloud Vision API 提取 `faceDetection` bounding box 坐标再传递给 Sharp 引擎提取矩阵 `sharp.extract()`），整体容器时延依然控制在亚秒级。
- **业务对齐价值**：完美对标 AWS Rekognition 的智能裁图逻辑，保证迁移客户在社交头像生成、新闻焦点图裁切等业务场景中毫无差异。

---

## 4. 场景四：企业级安全防护与防刷校验 (`HMAC Signature & Denial-of-Wallet Defense`)

> **场景背景 (Scenario Context)**  
> 在开放互联网 CDN 架构中，如果动态处理端点完全没有任何签名校验，恶意黑客可通过随机循环遍历任意尺寸参数 (`?width=1&height=1`, `?width=2&height=2`...) 来消耗巨额的无服务器 CPU 算力与网络流出费用（即“拒绝钱包攻击 - Denial of Wallet”）。本场景展示由 **GCP Secret Manager + HMAC-SHA256 签名校验** 构成的坚固防线。

### 4.1 开启签名验证与模拟攻击拦截实测
假设服务在环境变量中开启了 `ENABLE_SIGNATURE=Yes` 并通过 Secret Manager 绑定了校验秘钥 (`my-secure-hmac-key`)：

```bash
# 1. 模拟攻击者未带合法签名的参数遍历请求 (Expected: 403 Forbidden)
echo "[测试非法请求] 发起无签名或者签名错乱的请求..."
HTTP_STATUS=$(curl -sSL -o /dev/null -w "%{http_code}" "${SERVICE_URL}/catalog/sample-product.jpg?width=9999&height=9999")
echo "返回 HTTP 状态码: ${HTTP_STATUS} (预期: 403 AccessDenied)"

# 2. 模拟跨源访问未授权存储桶越界请求 (Expected: 403 Forbidden)
UNAUTHORIZED_BUCKET_JSON=$(echo -n '{"bucket":"hacker-unauthorized-bucket","key":"secrets.png"}' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
BUCKET_STATUS=$(curl -sSL -o /dev/null -w "%{http_code}" "${SERVICE_URL}/${UNAUTHORIZED_BUCKET_JSON}")
echo "返回越界存储桶 HTTP 状态码: ${BUCKET_STATUS} (预期: 403 AccessDenied)"
```

### 4.2 CE 验证指标 (What to highlight to the customer)
- **精细化权限边界**：通过 `SOURCE_BUCKETS` 白名单机制与 Secret Manager 动态秘钥校验，确保所有转码与回源行为被锁死在授权范围内。
- **与 Cloud Armor 的纵深组合**：即便攻击者使用高并发脚本构造超大请求，外层的 **Google Cloud Armor** 速率限制 (Rate Limiting policy - 500 req/min) 可立即在边缘层面进行拦截封禁，保障后端容器安全。

---

## 5. 总结与端到端自动化验证套件 (`E2E Automated Verification`)

除了手工通过 `curl` 进行场景体验之外，我们已在仓库的 `test/e2e/run-e2e.ts` 和 `scripts/verify-e2e.sh` 中为您封装了完全自动化的测试脚本。您只需随时在终端中运行一键回归脚本：

```bash
cd /Users/lileon/Documents/Projects/jk/gcp-serverless-image-handler
bash scripts/verify-e2e.sh --service-url "${SERVICE_URL}"
```

该自动化套件会在数秒内执行全覆盖测试（Health Endpoint 校验、Base64 解码校验、Query 转换校验、Thumbor 解析校验及安全异常状态拦截确认），并在控制台输出整洁清爽的全绿验收通过报告！
