import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Lightweight YAML validator for the project's compose file. We intentionally avoid
// pulling a YAML library to keep the dependency surface as small as the operator
// experience: native Node only.
const composePath = resolve(process.cwd(), 'docker-compose.yml')
const text = readFileSync(composePath, 'utf8')

const required = [
  { name: 'shorts-autopilot service', test: /services:\s*\n\s*shorts-autopilot:/m },
  { name: 'dockerfile build', test: /build:\s+\.\s*$/m },
  { name: 'persistent volume', test: /volumes:\s*\n\s*shorts_data:/m },
  { name: 'media bind mount', test: /\.\/media:\/app\/data\/media/m },
  { name: 'env_file reference', test: /env_file:\s*\n\s*-\s*\.env/m },
  { name: 'healthcheck endpoint', test: /healthcheck:\s*\n\s*test:.*\/api\/health/m },
  { name: 'port mapping 8787', test: /ports:\s*\n\s*-\s*"8787:8787"/m },
  { name: 'restart policy', test: /restart:\s*unless-stopped/m },
] 

const failures = required.filter(check => !check.test.test(text))
if (failures.length) {
  console.error('Compose definition is missing required entries:')
  for (const failure of failures) console.error(` - ${failure.name}`)
  process.exit(1)
}

console.log(JSON.stringify({ composeFile: composePath, service: 'shorts-autopilot', port: 8787, persistentVolume: 'shorts_data', healthcheck: '/api/health' }, null, 2))
