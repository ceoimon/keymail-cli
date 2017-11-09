const {
  keys: {
    PublicKey,
    IdentityKey
  }
} = require('proteus-hd')
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

function padTo512Bytes(plaintext) {
  const typeArrayText = sodium.from_string(plaintext)
  const messageByteLength = typeArrayText.byteLength
  if (messageByteLength >= 512) {
    throw new RangeError('Message to large')
  }
  const result = new Uint8Array(512).fill(0xFF) // fill random number?
  result.set(typeArrayText)
  return [
    result,
    messageByteLength
  ]
}

function unpad512BytesMessage(padded512BytesMessage, messageByteLength) {
  return sodium.to_string(padded512BytesMessage.subarray(
    0,
    messageByteLength
  ))
}

const bytes32Zero = '0x0000000000000000000000000000000000000000000000000000000000000000'

async function getPreKeyBundle({
  trustbase,
  preKeyStore,
  usernameHash
}) {
  const identityKeyString = await trustbase.getIdentity(usernameHash, { isHash: true })
  const identityKey = identityKeyFromHexStr(identityKeyString.slice(2))

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

  const preKeyPublicKey = publicKeyFromHexStr(preKeyPublicKeyString.slice(2))

  return MyPreKeyBundle.new(identityKey, preKeyPublicKey, preKeyID)
}

module.exports = {
  unixToday,
  getPreKeyBundle,
  publicKeyFromHexStr,
  identityKeyFromHexStr,
  padTo512Bytes,
  unpad512BytesMessage
}
