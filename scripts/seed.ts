import { loadConfig } from '../server/config.js'
import { ShortsDatabase } from '../server/db.js'

const config = loadConfig()
const db = new ShortsDatabase({ filename: config.dbPath, seed: true })
console.log(`Database ready at ${config.dbPath}`)
console.log(JSON.stringify({ topics: db.listTopics().length, scripts: db.listScripts().length, videos: db.listVideos().length, uploads: db.listUploads().length }, null, 2))
db.close()
