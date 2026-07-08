# Deploying to AWS ECS (Fargate)

## Architecture

The bot runs as a single always-on Fargate task (long-polling Telegram
client + cron scheduler, no inbound HTTP). Deployed resources:

| Resource | Name |
|---|---|
| ECR repository | `tomasidesign/analytics-bot` (immutable tags, scan-on-push) |
| ECS cluster | `tomasi-analytics-bot-cluster` (FARGATE + FARGATE_SPOT) |
| ECS service | `tomasi-analytics-bot-service` (desired count: 1) |
| Task definition family | `tomasi-analytics-bot` |
| Task execution role | `ecsTaskExecutionRole` (existing, pulls image + reads secrets) |
| Task role | `tomasi-analytics-bot-task-role` (app's own AWS permissions) |
| Security group | `tomasi-analytics-bot-sg` (outbound-only, no inbound rules) |
| CloudWatch log group | `/ecs/tomasi-analytics-bot` (30-day retention) |
| Secrets | `posthog-insights-engine/POSTHOG_API_KEY`, `AI_API_KEY`, `TELEGRAM_BOT_TOKEN` in Secrets Manager |

## Security decisions

- **No static AWS credentials in the container.** The task assumes
  `tomasi-analytics-bot-task-role` via ECS's built-in task role
  mechanism, so the AWS SDK gets short-lived, auto-rotating
  credentials automatically. `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
  are never set in the task definition.
- **Task role is scoped to one S3 prefix.** It can only
  `GetObject`/`PutObject` under `s3://tomasi-vercel-images/posthog-insights-engine/*`
  and list that one prefix — it cannot touch the rest of the bucket
  (which holds unrelated Vercel image assets) or any other bucket.
- **Secrets come from Secrets Manager, not plaintext env vars.** API
  keys are injected via the task definition's `secrets` block, which
  ECS resolves at container start and never writes to disk or logs.
- **No inbound network access.** The security group has zero inbound
  rules — this process only makes outbound calls (Telegram, PostHog,
  Gemini, S3), so there's nothing to expose.
- **Runs as a non-root user** inside the container (`appuser`), and
  the image is built from a minimal Alpine base with dev dependencies
  excluded.
- **Immutable image tags.** Once pushed, a tag like `v3` can never be
  overwritten — deployments always reference an exact, auditable
  image digest.

## One-time setup (already done for this deployment)

```bash
# ECR repo
aws ecr create-repository --repository-name tomasidesign/analytics-bot \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  --image-tag-mutability IMMUTABLE

# Secrets (repeat for POSTHOG_API_KEY, AI_API_KEY, TELEGRAM_BOT_TOKEN)
aws secretsmanager create-secret --name "posthog-insights-engine/<NAME>" --secret-string "<value>"

# Task role (least-privilege S3 access — see task-role-*.json in this folder)
aws iam create-role --role-name tomasi-analytics-bot-task-role \
  --assume-role-policy-document file://deploy/task-role-trust-policy.json
aws iam put-role-policy --role-name tomasi-analytics-bot-task-role \
  --policy-name S3ScopedAccess --policy-document file://deploy/task-role-s3-policy.json

# Cluster, log group, security group
aws logs create-log-group --log-group-name /ecs/tomasi-analytics-bot
aws logs put-retention-policy --log-group-name /ecs/tomasi-analytics-bot --retention-in-days 30
aws ecs create-cluster --cluster-name tomasi-analytics-bot-cluster \
  --capacity-providers FARGATE FARGATE_SPOT \
  --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1
aws ec2 create-security-group --group-name tomasi-analytics-bot-sg \
  --description "Outbound-only SG for the Tomasi analytics bot" --vpc-id <VPC_ID>

# Task definition + service
aws ecs register-task-definition --cli-input-json file://deploy/task-definition.json
aws ecs create-service --cluster tomasi-analytics-bot-cluster \
  --service-name tomasi-analytics-bot-service \
  --task-definition tomasi-analytics-bot:1 --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<SUBNET_ID>],securityGroups=[<SG_ID>],assignPublicIp=ENABLED}"
```

## Redeploying after a code change

Use `deploy/deploy.sh` (below), or run manually:

```bash
# 1. Build for the correct architecture — Fargate runs linux/amd64.
#    If you're on Apple Silicon, `docker build` alone produces an
#    arm64 image that Fargate will reject with CannotPullContainerError.
docker buildx build --platform linux/amd64 \
  -t 167611893897.dkr.ecr.us-east-1.amazonaws.com/tomasidesign/analytics-bot:vN \
  --push .

# 2. Bump the image tag in deploy/task-definition.json to :vN
#    (tags are immutable — you cannot reuse a previous tag)

# 3. Register the new revision and roll it out
aws ecs register-task-definition --cli-input-json file://deploy/task-definition.json
aws ecs update-service --cluster tomasi-analytics-bot-cluster \
  --service tomasi-analytics-bot-service \
  --task-definition tomasi-analytics-bot:<new-revision> \
  --force-new-deployment
```

## Verifying a deployment

```bash
# Service + task status
aws ecs describe-services --cluster tomasi-analytics-bot-cluster \
  --services tomasi-analytics-bot-service \
  --query 'services[0].{running:runningCount,desired:desiredCount,events:events[0:3]}'

TASK_ARN=$(aws ecs list-tasks --cluster tomasi-analytics-bot-cluster --output text --query 'taskArns[0]')
aws ecs describe-tasks --cluster tomasi-analytics-bot-cluster --tasks "$TASK_ARN" \
  --query 'tasks[0].{status:lastStatus,health:healthStatus}'

# Logs
STREAM=$(aws logs describe-log-streams --log-group-name /ecs/tomasi-analytics-bot \
  --order-by LastEventTime --descending --max-items 1 --query 'logStreams[0].logStreamName' --output text)
aws logs get-log-events --log-group-name /ecs/tomasi-analytics-bot --log-stream-name "$STREAM" --limit 20
```

## Known limitation: single-task, no HA

`desiredCount` is 1 with no load balancer — if the task crashes, ECS
restarts it automatically (usually within ~1-2 minutes), but there's a
brief gap where the bot won't respond. For a Telegram long-polling bot
this is normal and acceptable; do not run more than 1 task at a time,
since Telegram's long-polling API only allows one active connection
per bot token (a second task would conflict and get 409 errors from
Telegram).
