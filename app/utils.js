const {
  PublicKey,
  IdentityKey
} = require('wire-webapp-proteus').keys
const sodium = require('libsodium-wrappers-sumo')
const ed2curve = require('ed2curve')

function getUnixDay(javaScriptTimestamp) {
  return Math.floor(javaScriptTimestamp / 1000 / 3600 / 24)
}

function unixToday() {
  return getUnixDay(Date.now())
}

function publicKeyFromHexStr(publicKeyHexString) {
  const prekeyPublicKeyEd = sodium.from_hex(publicKeyHexString)
  const prekeyPublicKeyCurve = ed2curve.convertPublicKey(prekeyPublicKeyEd)
  return PublicKey.new(
    prekeyPublicKeyEd,
    prekeyPublicKeyCurve
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

module.exports = {
  unixToday,
  publicKeyFromHexStr,
  identityKeyFromHexStr
}
