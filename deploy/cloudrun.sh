#!/usr/bin/env bash
# Build and deploy Branchwise to Cloud Run (Sydney). Run from the repo root:
#   deploy/cloudrun.sh
# One-time setup already done for branchwise-514403: services enabled, Firestore (default)
# in australia-southeast1, service account branchwise-run with roles/datastore.user,
# secrets branchwise-secret-key and branchwise-groq-key.
set -euo pipefail
PROJECT="${PROJECT:-branchwise-514403}"
REGION="${REGION:-australia-southeast1}"
SA="branchwise-run@${PROJECT}.iam.gserviceaccount.com"

gcloud run deploy branchwise \
  --project "$PROJECT" --region "$REGION" --source . \
  --service-account "$SA" \
  --allow-unauthenticated \
  --cpu 1 --memory 1Gi --concurrency 40 \
  --min-instances 0 --max-instances 3 \
  --timeout 60 \
  --set-env-vars "APP_ENV=production,STORAGE=firestore,GOOGLE_CLOUD_PROJECT=${PROJECT},TRUST_PROXY=true" \
  --set-secrets "SECRET_KEY=branchwise-secret-key:latest,GROQ_API_KEY=branchwise-groq-key:latest" \
  --quiet
