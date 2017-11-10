const {
  keys: {
    PublicKey,
    IdentityKey
    // IdentityKeyPair
  },
  message: {
    CipherMessage
  }
} = require('wire-webapp-proteus')
const CBOR = require('wire-webapp-cbor')
const sodium = require('libsodium-wrappers')

class MyEnvelope {
  constructor(header, cipherMessage) {
    this.header = header
    this.cipherMessage = cipherMessage
  }

  encrypt(ourIdentityKeyPair, preKeyID, preKeyPublicKey) {
    const nonce = Buffer.from(sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES))
    const envelopeBuf = Buffer.from(sodium.crypto_box_easy(
      new Uint8Array(this.serialise()), // binary represent
      nonce,
      preKeyPublicKey.pub_curve,
      ourIdentityKeyPair.secret_key.sec_curve
    ))
    // prepend the pre-key ID and nonce
    const preKeyIDBuf = Buffer.from(Uint16Array.from([preKeyID]).buffer)
    const concatedBuf = Buffer.concat([preKeyIDBuf, nonce, envelopeBuf]) // Buffer
    return sodium.to_hex(concatedBuf)
  }

  static decrypt(nonceAndEnvelopeBuf, preKey, theirIdentityKey) {
    const nonce = nonceAndEnvelopeBuf.slice(0, sodium.crypto_box_NONCEBYTES)
    const envelopeBuf = nonceAndEnvelopeBuf.slice(sodium.crypto_box_NONCEBYTES)
    return MyEnvelope.deserialize(sodium.crypto_box_open_easy(
      envelopeBuf,
      nonce,
      theirIdentityKey.public_key.pub_curve,
      preKey.key_pair.secret_key.sec_curve,
      'uint8array'
    ).buffer)
  }

  serialise() {
    const e = new CBOR.Encoder()
    this.encode(e)
    return e.get_buffer()
  }

  static deserialize(buf) {
    const d = new CBOR.Decoder(buf)
    return MyEnvelope.decode(d)
  }

  encode(e) {
    const {
      mac,
      baseKey,
      identityKey,
      isPreKeyMessage,
      messageType,
      messageByteLength
    } = this.header

    e.object(7)
    e.u8(0)
    e.object(1)
    e.u8(0)
    e.bytes(mac)
    e.u8(1)
    baseKey.encode(e)
    e.u8(2)
    identityKey.encode(e)
    e.u8(3)
    e.u8(isPreKeyMessage)
    e.u8(4)
    e.u8(messageType)
    e.u8(5)
    e.object(1)
    e.u8(0)
    e.bytes(new Uint8Array(Uint16Array.from([messageByteLength]).buffer))
    e.u8(6)
    this.cipherMessage.encode(e)
  }

  static decode(d) {
    const header = {}
    let cipherMessage
    const nprops = d.object()
    for (let i = 0; i <= nprops - 1; i += 1) {
      switch (d.u8()) {
        case 0: {
          const npropsMac = d.object()
          for (let j = 0; j <= npropsMac - 1; j += 1) {
            switch (d.u8()) {
              case 0:
                header.mac = new Uint8Array(d.bytes())
                break
              default:
                d.skip()
            }
          }
          break
        }
        case 1: {
          header.baseKey = PublicKey.decode(d)
          break
        }
        case 2: {
          header.identityKey = IdentityKey.decode(d)
          break
        }
        case 3: {
          header.isPreKeyMessage = d.u8()
          break
        }
        case 4: {
          header.messageType = d.u8()
          break
        }
        case 5: {
          const npropsMac = d.object()
          for (let j = 0; j <= npropsMac - 1; j += 1) {
            switch (d.u8()) {
              case 0:
                header.messageByteLength = new Uint16Array(new Uint8Array(d.bytes()).buffer)[0]
                break
              default:
                d.skip()
            }
          }
          break
        }
        case 6: {
          cipherMessage = CipherMessage.decode(d)
          break
        }
        default: {
          d.skip()
        }
      }
    }
    delete header.test
    return new MyEnvelope(header, cipherMessage)
  }
}

module.exports = MyEnvelope
