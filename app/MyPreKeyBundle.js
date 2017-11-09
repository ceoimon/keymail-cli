const {
  PreKeyBundle,
  PreKey
} = require('proteus-hd').keys

class MyPreKeyBundle extends PreKeyBundle {
  static new(publicIdentityKey, preKeyPublicKey, keyID) {
    const bundle = super.new(publicIdentityKey, PreKey.new(keyID))

    bundle.public_key = preKeyPublicKey

    return bundle
  }
}

module.exports = MyPreKeyBundle
