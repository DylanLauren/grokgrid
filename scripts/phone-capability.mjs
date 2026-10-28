// Produce an encrypted screen-only capability without printing any credential.
import { readFileSync, writeFileSync } from 'node:fs'
import { constants, createHmac, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'
const args = process.argv.slice(2)
const arg = (name) => args[args.indexOf(name) + 1]
try {
  for (const name of ['--token-file', '--public-key', '--out']) if (!args.includes(name) || !arg(name)) throw Error('missing argument')
  const secret = readFileSync(arg('--token-file'), 'utf8').trim()
  if (!secret) throw Error('missing credential')
  const key = createPublicKey(readFileSync(arg('--public-key')))
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072) throw Error('invalid public key')
  const expires = Math.floor(Date.now() / 1000) + 7 * 86400
  const payload = `screen-v1.${expires}.${randomBytes(16).toString('hex')}`
  const capability = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
  const encrypted = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(capability))
  writeFileSync(arg('--out'), encrypted.toString('base64'), { mode: 0o600, flag: 'wx' })
  console.log(`Encrypted screen-only capability created. Expires ${new Date(expires * 1000).toISOString()}.`)
} catch {
  console.error('Could not create encrypted screen capability. Check paths and use a new output file; no credential was printed.')
  process.exitCode = 1
}
