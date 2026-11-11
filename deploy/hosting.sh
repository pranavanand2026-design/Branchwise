#!/usr/bin/env bash
# Point https://branchwise.web.app at the Cloud Run service (Firebase Hosting rewrite).
# Same as `firebase deploy --only hosting` with firebase.json, without needing the Firebase CLI.
# Run from the repo root after deploy/cloudrun.sh.
set -euo pipefail
PROJECT="${PROJECT:-branchwise-514403}"
SITE="${SITE:-branchwise}"
API="https://firebasehosting.googleapis.com/v1beta1"
TOKEN="$(gcloud auth print-access-token)"
call() { curl -fsS -H "Authorization: Bearer ${TOKEN}" -H "x-goog-user-project: ${PROJECT}" -H "Content-Type: application/json" "$@"; }

# Every path goes to the Cloud Run service, which serves both the site and /api
VERSION=$(call -X POST "${API}/sites/${SITE}/versions" -d '{
  "config": { "rewrites": [ { "glob": "**", "run": { "serviceId": "branchwise", "region": "australia-southeast1" } } ] }
}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
call -X PATCH "${API}/${VERSION}?update_mask=status" -d '{"status":"FINALIZED"}' >/dev/null
call -X POST "${API}/sites/${SITE}/releases?versionName=${VERSION}" -d '{}' >/dev/null
echo "Released ${VERSION} -> https://${SITE}.web.app"
