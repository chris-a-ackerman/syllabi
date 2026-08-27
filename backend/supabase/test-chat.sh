#!/bin/bash

ANON_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
MESSAGE="${1:-What is due this week?}"

# Get JWT
TOKEN=$(curl -s -X POST 'http://localhost:54321/auth/v1/token?grant_type=password' \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}' | jq -r '.access_token')

echo "TOKEN: $TOKEN"

# Get semester ID
SEMESTER_ID=$(curl -s 'http://localhost:54321/rest/v1/semesters?select=id&is_active=eq.true' \
  -H "Authorization: Bearer $TOKEN" \
  -H "apikey: $ANON_KEY" | jq -r '.[0].id')

echo "SEMESTER_ID: $SEMESTER_ID"

# Call chat function
curl -v -X POST 'http://localhost:54321/functions/v1/chat' \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"$MESSAGE\", \"semester_id\": \"$SEMESTER_ID\", \"conversation_history\": []}"