# End-to-end tests

Runs the node inside a real n8n against a real Scopevisio tenant. The unit tests
in `test/` prove the logic; these prove the integration — that n8n loads the
package, that the credential authenticates, and that each operation does what it
claims against the live API.

**These write to the tenant.** They create contacts, a debitor account and a
product. They never post anything to the ledger: the posting test only checks
that posting refuses to run without confirmation. Use a test tenant.

## What was run

26 workflow tests plus a live polling-trigger test, against n8n 2.38.7 and the
Scopevisio test tenant (customer 2039915, organisation "Simplify AG"). All
passed. See `docs/N8N-FINDINGS.md` in the repository root for what they found.

## Running them

```bash
# 1. Build and pack the node
npm run build && npm pack

# 2. Start n8n with the package installed as a community node
mkdir -p /tmp/n8n-e2e && cp n8n-nodes-scopevisio-*.tgz /tmp/n8n-e2e/
docker run -d --name n8n-e2e -p 5678:5678 \
  -v n8n_e2e_data:/home/node/.n8n -v /tmp/n8n-e2e:/e2e:ro \
  -e N8N_SECURE_COOKIE=false \
  --entrypoint sh docker.n8n.io/n8nio/n8n:latest -c '
    mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes &&
    ([ -f package.json ] || npm init -y >/dev/null) &&
    npm install --legacy-peer-deps /e2e/n8n-nodes-scopevisio-*.tgz &&
    exec n8n start'

# 3. Import two credentials: a working one (id svCredE2E0000001) and a
#    deliberately revoked one (id svCredBAD0000001). The credential file holds a
#    real refresh token — keep it out of version control and delete it after.
docker exec n8n-e2e n8n import:credentials --input=/e2e/credentials.json

# 4. Generate and import the workflows
python3 e2e/generate-workflows.py /tmp/n8n-e2e/workflows
docker exec n8n-e2e n8n import:workflow --separate --input=/e2e/workflows/

# 5. Run each test and assert
mkdir -p /tmp/n8n-e2e/results
for f in /tmp/n8n-e2e/workflows/e2eT[0-3]*.json; do
  id=$(basename "$f" .json)
  docker exec -e N8N_RUNNERS_BROKER_PORT=5690 n8n-e2e n8n execute --id=$id --rawOutput \
    > /tmp/n8n-e2e/results/$id.json 2>&1
done
python3 e2e/assert.py /tmp/n8n-e2e/results
```

Two details that cost time:

- **`N8N_RUNNERS_BROKER_PORT`** — `n8n execute` inside a running container tries
  to start its own task broker on the port the server already holds, and fails.
- **The polling trigger cannot be run with `n8n execute`**, which needs a manual
  trigger ("Missing node to start execution"). Activate `e2eT32TriggerLive0`
  through the editor or the REST API instead, wait for the first poll (it
  records a baseline and emits nothing), create a contact in Scopevisio, and
  check that the next poll's execution contains exactly that contact.
