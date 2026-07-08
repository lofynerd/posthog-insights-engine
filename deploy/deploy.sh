#!/usr/bin/env bash
# Build, push, and roll out a new version of the analytics bot to ECS.
#
# Usage: ./deploy/deploy.sh <version-tag>
# Example: ./deploy/deploy.sh v4
#
# Requires: docker buildx, aws cli configured with credentials that
# can push to ECR and update the ECS service.
set -euo pipefail

VERSION="${1:?Usage: deploy.sh <version-tag> (e.g. v4)}"
REGION="us-east-1"
ACCOUNT_ID="167611893897"
REPO="tomasidesign/analytics-bot"
IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO}:${VERSION}"
CLUSTER="tomasi-analytics-bot-cluster"
SERVICE="tomasi-analytics-bot-service"
TASK_DEF_FILE="$(dirname "$0")/task-definition.json"

echo "==> Authenticating Docker to ECR..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Building linux/amd64 image and pushing ${IMAGE}..."
# Fargate runs linux/amd64. Building on Apple Silicon without
# --platform produces an arm64 image ECS will reject at pull time.
docker buildx build --platform linux/amd64 -t "$IMAGE" --push "$(dirname "$0")/.."

echo "==> Updating task definition to use ${VERSION}..."
TMP_TASK_DEF=$(mktemp)
node -e "
const fs = require('fs');
const def = JSON.parse(fs.readFileSync('${TASK_DEF_FILE}', 'utf8'));
def.containerDefinitions[0].image = '${IMAGE}';
fs.writeFileSync('${TMP_TASK_DEF}', JSON.stringify(def, null, 2));
"

echo "==> Registering new task definition revision..."
NEW_REVISION=$(aws ecs register-task-definition \
  --cli-input-json "file://${TMP_TASK_DEF}" \
  --query 'taskDefinition.revision' --output text)
rm -f "$TMP_TASK_DEF"

echo "==> Rolling out revision ${NEW_REVISION}..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "tomasi-analytics-bot:${NEW_REVISION}" \
  --force-new-deployment \
  --query 'service.{status:status,taskDefinition:taskDefinition}'

echo "==> Waiting for the service to stabilize (this can take a minute or two)..."
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"

echo "==> Done. Deployed ${IMAGE} as revision ${NEW_REVISION}."
