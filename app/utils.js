const {
  keys: {
    PublicKey,
    IdentityKey
  },
  message: {
    Envelope
  }
} = require('wire-webapp-proteus')
const sodium = require('libsodium-wrappers')
const ed2curve = require('ed2curve')

const MyPreKeyBundle = require('./MyPreKeyBundle')

function getUnixDay(javaScriptTimestamp) {
  return Math.floor(javaScriptTimestamp / 1000 / 3600 / 24)
}

function unixToday() {
  return getUnixDay(Date.now())
}

function publicKeyFromHexStr(publicKeyHexString) {
  const preKeyPublicKeyEd = sodium.from_hex(publicKeyHexString)
  const preKeyPublicKeyCurve = ed2curve.convertPublicKey(preKeyPublicKeyEd)
  return PublicKey.new(
    preKeyPublicKeyEd,
    preKeyPublicKeyCurve
  )
}

function identityKeyFromHexStr(identityKeyHexString) {
  const bobIdentityKeyEd = sodium.from_hex(identityKeyHexString)
  const bobIdentityKeyCurve = ed2curve.convertPublicKey(bobIdentityKeyEd)
  return IdentityKey.new(PublicKey.new(
    bobIdentityKeyEd,
    bobIdentityKeyCurve
  ))
}

function getEmptyEnvelope() {
  // Just take a random valid envelope
  const aValidEnvelope = Envelope.deserialise(sodium.from_hex('a3000101a100582008071b607d3fbbe7f11d3f92312cca2f15acdef7e9895d61a364924ce59e9bc902589502a40019443a01a10058206f5fcfc5e6009b64f33b2566ec56ec8ac35c115664f899322d65b5f13ad4b99c02a100a10058200652d346c72a8995677347028917f55ad18b3898aed4ac8ed984e43857e35b8f03a5005054c4b855b93b737e30c9f4dd891a3b330111020003a1005820dc9884435f77974e03ce9a04b7158f13f2576b9f5e2decc7bf881febb90c7f7e0444279808e9').buffer)
  const emptyEnvelope = Object.create(Object.getPrototypeOf(aValidEnvelope))
  emptyEnvelope.version = 1
  return emptyEnvelope
}

function padTo512Bytes(plaintext) {
  const typeArrayText = sodium.from_string(plaintext)
  const messageByteLength = typeArrayText.byteLength
  if (messageByteLength >= 512) {
    throw new RangeError('Message to large')
  }
  const result = new Uint8Array(512).fill(0xFF) // fill random number?
  result.set(typeArrayText)
  return {
    result,
    messageByteLength
  }
}

function unpad512BytesMessage(padded512BytesMessage, messageByteLength) {
  return sodium.to_string(padded512BytesMessage.subarray(
    0,
    messageByteLength
  ))
}

const bytes32Zero = '0x0000000000000000000000000000000000000000000000000000000000000000'

async function getPreKey({
  preKeyStore,
  usernameHash
}) {
  const {
    interval,
    lastPrekeysDate
  } = await preKeyStore.getMetaData(usernameHash, { isHash: true })

  let preKeyPublicKeyString = bytes32Zero
  let preKeyID = unixToday()
  if (preKeyID > lastPrekeysDate) {
    preKeyPublicKeyString = await preKeyStore.getPrekey(usernameHash, 65535, { isHash: true })
    preKeyID = 65535
  } else {
    const limitDay = preKeyID - interval
    while (preKeyID > limitDay && preKeyPublicKeyString === bytes32Zero) {
      // eslint-disable-next-line
      preKeyPublicKeyString = await preKeyStore.getPrekey(usernameHash, preKeyID, { isHash: true })
      preKeyID -= 1
    }
    preKeyID += 1

    // If not found, use last-resort pre-key
    if (preKeyPublicKeyString === bytes32Zero) {
      preKeyPublicKeyString = await preKeyStore.getPrekey(usernameHash, 65535, { isHash: true })
      preKeyID = 65535
    }
  }

  const publicKey = publicKeyFromHexStr(preKeyPublicKeyString.slice(2))
  return {
    id: preKeyID,
    publicKey
  }
}

async function getPreKeyBundle({
  trustbase,
  usernameHash,
  preKeyID,
  preKeyPublicKey
}) {
  const identityKeyString = await trustbase.getIdentity(usernameHash, { isHash: true })
  const identityKey = identityKeyFromHexStr(identityKeyString.slice(2))

  return MyPreKeyBundle.new(identityKey, preKeyPublicKey, preKeyID)
}

module.exports = {
  unixToday,
  getPreKey,
  getPreKeyBundle,
  publicKeyFromHexStr,
  identityKeyFromHexStr,
  getEmptyEnvelope,
  padTo512Bytes,
  unpad512BytesMessage
}
