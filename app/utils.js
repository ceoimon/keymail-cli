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
const PreKeysPackage = require('./PreKeysPackage')

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

async function getPreKeys({
  trustbasePreKeys,
  usernameOrusernameHash,
  isHash = false
}) {
  const preKeysPackageSerializedStr = await trustbasePreKeys.getPreKeys(
    usernameOrusernameHash,
    { isHash }
  )
  return PreKeysPackage.deserialize(sodium.from_hex(preKeysPackageSerializedStr.slice(2)).buffer)
}

async function getPreKey({
  interval,
  lastPrekeysDate,
  preKeyPublicKeys
}) {
  let preKeyPublicKeyString
  let preKeyID = unixToday()
  if (preKeyID > lastPrekeysDate) {
    preKeyID = lastPrekeysDate
    preKeyPublicKeyString = preKeyPublicKeys[preKeyID]
  } else {
    const limitDay = preKeyID - interval
    while (preKeyID > limitDay && preKeyPublicKeyString === undefined) {
      preKeyPublicKeyString = preKeyPublicKeys[preKeyID]
      preKeyID -= 1
    }
    preKeyID += 1

    // If not found, use last-resort pre-key
    if (preKeyPublicKeyString === undefined) {
      preKeyID = lastPrekeysDate
      preKeyPublicKeyString = await preKeyPublicKeys[lastPrekeysDate]
    }
  }

  const publicKey = publicKeyFromHexStr(preKeyPublicKeyString.slice(2))
  return {
    id: preKeyID,
    publicKey
  }
}

async function getPreKeyBundle({
  trustbaseIdentities,
  usernameHash,
  preKeyID,
  preKeyPublicKey
}) {
  const {
    publicKey: identityKeyString
  } = await trustbaseIdentities.getIdentity(usernameHash, { isHash: true })
  const identityKey = identityKeyFromHexStr(identityKeyString.slice(2))

  return MyPreKeyBundle.new(identityKey, preKeyPublicKey, preKeyID)
}

module.exports = {
  unixToday,
  getPreKey,
  getPreKeys,
  getPreKeyBundle,
  publicKeyFromHexStr,
  identityKeyFromHexStr,
  getEmptyEnvelope,
  padTo512Bytes,
  unpad512BytesMessage
}
