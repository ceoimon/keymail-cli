const CBOR = require('wire-webapp-cbor')
const sodium = require('libsodium-wrappers')

class PreKeysPackage {
  constructor(preKeyPublicKeys, interval, lastPrekeysDate) {
    this.interval = interval
    this.lastPrekeysDate = lastPrekeysDate
    this.preKeyPublicKeys = preKeyPublicKeys
  }

  serialise() {
    const e = new CBOR.Encoder()
    this.encode(e)
    return e.get_buffer()
  }

  static deserialize(buf) {
    const d = new CBOR.Decoder(buf)
    return PreKeysPackage.decode(d)
  }

  encode(e) {
    e.object(3)
    e.u8(0)
    e.u8(this.interval)
    e.u8(1)
    e.u16(this.lastPrekeysDate)
    e.u8(2)
    e.object(Object.keys(this.preKeyPublicKeys).length)
    Object.keys(this.preKeyPublicKeys).forEach((preKeyId) => {
      e.object(1)
      e.u16(preKeyId)
      e.bytes(sodium.from_hex(this.preKeyPublicKeys[preKeyId].slice(2)))
    })
  }

  static decode(d) {
    const nprops = d.object()
    let interval
    let lastPrekeysDate
    const preKeyPublicKeys = {}
    for (let i = 0; i < nprops; i += 1) {
      switch (d.u8()) {
        case 0: {
          interval = d.u8()
          break
        }
        case 1: {
          lastPrekeysDate = d.u16()
          break
        }
        case 2: {
          let len = d.object()
          while (len > 0) {
            const npropsPreKey = d.object()
            for (let j = 0; j < npropsPreKey; j += 1) {
              const preKeyId = d.u16()
              if (preKeyId) {
                preKeyPublicKeys[preKeyId] = `0x${sodium.to_hex(new Uint8Array(d.bytes()))}`
              } else {
                d.skip()
              }
            }
            len -= 1
          }
          break
        }
        default: {
          d.skip()
        }
      }
    }

    return new PreKeysPackage(preKeyPublicKeys, interval, lastPrekeysDate)
  }
}

module.exports = PreKeysPackage
