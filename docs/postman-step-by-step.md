# Postman Step-by-Step for MCP Brain

Use this guide to validate MCP connectivity, auth, and learning flow end-to-end.

## Prerequisites

- Server running on HTTP transport.
- Valid `MCP_AUTH_TOKEN` set in runtime.
- Postman installed.

## Postman Variables

Set collection (or environment) variables:

- `baseUrl` = `http://localhost:3737`
- `token` = `<your MCP_AUTH_TOKEN>`

For every `/mcp` request, set headers:

- `Authorization: Bearer {{token}}`
- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`

## Step 1: Health Check

Request:

- Method: `GET`
- URL: `{{baseUrl}}/health`

Expected:

- HTTP `200`
- JSON with `status: "ok"`

## Step 2: Verify Auth Gate

Request (without Authorization header):

- Method: `POST`
- URL: `{{baseUrl}}/mcp`
- Body:

```json
{
  "jsonrpc": "2.0",
  "id": "auth-check",
  "method": "tools/list",
  "params": {}
}
```

Expected:

- HTTP `401 Unauthorized`

## Step 3: List Available Tools

Request (with Authorization header):

- Method: `POST`
- URL: `{{baseUrl}}/mcp`
- Body:

```json
{
  "jsonrpc": "2.0",
  "id": "tools-1",
  "method": "tools/list",
  "params": {}
}
```

Expected:

- HTTP `200`
- Tool list includes `query`, `feedback`, `learn`

## Step 4: Run Query (Create Interaction)

Request:

- Method: `POST`
- URL: `{{baseUrl}}/mcp`
- Body:

```json
{
  "jsonrpc": "2.0",
  "id": "q-1",
  "method": "tools/call",
  "params": {
    "name": "query",
    "arguments": {
      "text": "How do I reset my account password?",
      "topK": 5
    }
  }
}
```

Expected:

- HTTP `200`
- Response contains `interactionId`

Save `interactionId` for next step.

## Step 5: Send Feedback (Teach Quality)

Request:

- Method: `POST`
- URL: `{{baseUrl}}/mcp`
- Body:

```json
{
  "jsonrpc": "2.0",
  "id": "f-1",
  "method": "tools/call",
  "params": {
    "name": "feedback",
    "arguments": {
      "interactionId": "PUT_INTERACTION_ID_FROM_STEP_4",
      "qualityScore": 0.95,
      "route": "support-auth",
      "forceLearnAfterFeedback": false
    }
  }
}
```

Expected:

- HTTP `200`
- Feedback accepted

## Step 6: Trigger Learning Pass

Request:

- Method: `POST`
- URL: `{{baseUrl}}/mcp`
- Body:

```json
{
  "jsonrpc": "2.0",
  "id": "learn-1",
  "method": "tools/call",
  "params": {
    "name": "learn",
    "arguments": {}
  }
}
```

Expected:

- HTTP `200`
- Learn status in response

## Step 7: Re-Query to Validate Learning

Request:

- Method: `POST`
- URL: `{{baseUrl}}/mcp`
- Body:

```json
{
  "jsonrpc": "2.0",
  "id": "q-2",
  "method": "tools/call",
  "params": {
    "name": "query",
    "arguments": {
      "text": "I forgot my password. What should I do?",
      "topK": 5
    }
  }
}
```

Expected:

- HTTP `200`
- Updated pattern/interaction response

## Negative Tests (Optional)

- Missing token: expect `401`
- Oversized payload: expect `413`
- Burst too many requests quickly: expect `429`

## Troubleshooting

- `401`: missing or wrong bearer token
- `406`: missing/incorrect `Accept` header. Set `Accept: application/json, text/event-stream`
- `413`: payload exceeds `MCP_MAX_BODY_BYTES`
- `429`: rate limit exceeded (`MCP_RATE_LIMIT_*`)
- `500`: inspect server/container logs
