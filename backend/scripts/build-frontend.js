const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const frontendDirectory = path.resolve(__dirname, '../../frontend')
const frontendDist = path.join(frontendDirectory, 'dist')
const backendPublic = path.resolve(__dirname, '../public')

execSync('npm run build -- --mode single', { cwd: frontendDirectory, stdio: 'inherit' })

if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
  throw new Error(`Frontend build not found at ${frontendDist}`)
}

fs.mkdirSync(backendPublic, { recursive: true })
fs.cpSync(frontendDist, backendPublic, { recursive: true })
console.log(`Copied frontend build to ${backendPublic}`)
