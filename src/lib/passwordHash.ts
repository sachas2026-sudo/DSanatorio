const PBKDF2_ITERATIONS = 120_000
const SALT_BYTES = 16
const HASH_BYTES = 32

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: Uint8Array.from(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BYTES * 8,
  )
  return {
    salt: toBase64(salt),
    hash: toBase64(new Uint8Array(derived)),
  }
}

export async function verifyPassword(
  password: string,
  hashBase64: string,
  saltBase64: string,
): Promise<boolean> {
  const salt = fromBase64(saltBase64)
  const expected = fromBase64(hashBase64)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const saltBytes = Uint8Array.from(salt)
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BYTES * 8,
  )
  const actual = new Uint8Array(derived)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) {
    diff |= actual[i]! ^ expected[i]!
  }
  return diff === 0
}
