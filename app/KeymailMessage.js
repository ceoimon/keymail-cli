const CBOR = require('wire-webapp-cbor')
const {
  padTo512Bytes,
  unpad512BytesMessage
} = require('./utils')

const {
  MESSAGE_TYPES: {
    HELLO_MESSAGE,
    NORMAL_MESSAGE
  }
} = require('./constants')

class KeymailMessage {
  constructor(header, plainText) {
    this.header = header
    this.plainText = plainText
  }

  serialise() {
    const e = new CBOR.Encoder()
    this.encode(e)
    return e.get_buffer()
  }

  static deserialize(buf) {
    const d = new CBOR.Decoder(buf)
    return KeymailMessage.decode(d)
  }

  encode(e) {
    const {
      fromUsername,
      messageType
    } = this.header
    const plainText = this.plainText

    let processedMessage
    let messageByteLength
    switch (messageType) {
      case HELLO_MESSAGE: {
        [processedMessage, messageByteLength] = padTo512Bytes(JSON.stringify({
          plainText,
          fromUsername
        }))
        break
      }
      case NORMAL_MESSAGE: {
        [processedMessage, messageByteLength] = padTo512Bytes(plainText)
        break
      }
      default:
        throw new Error('Unknown message type')
    }

    e.object(3)
    e.u8(0)
    e.u8(messageType)
    e.u8(1)
    e.object(1)
    e.u8(0)
    e.bytes(new Uint8Array(Uint16Array.from([messageByteLength]).buffer))
    e.u8(2)
    e.bytes(processedMessage)
  }

  static decode(d) {
    const header = {}
    let plainText

    let processedMessage
    let messageByteLength

    const nprops = d.object()
    for (let i = 0; i <= nprops - 1; i += 1) {
      switch (d.u8()) {
        case 0: {
          header.messageType = d.u8()
          break
        }
        case 1: {
          const npropsMac = d.object()
          for (let j = 0; j <= npropsMac - 1; j += 1) {
            switch (d.u8()) {
              case 0:
                messageByteLength = new Uint16Array(new Uint8Array(d.bytes()).buffer)[0]
                break
              default:
                d.skip()
            }
          }
          break
        }
        case 2: {
          processedMessage = new Uint8Array(d.bytes())
          break
        }
        default: {
          d.skip()
        }
      }
    }

    switch (header.messageType) {
      case HELLO_MESSAGE: {
        const serializedHelloMessage = unpad512BytesMessage(processedMessage, messageByteLength);
        ({
          plainText,
          fromUsername: header.fromUsername
        } = JSON.parse(serializedHelloMessage))
        break
      }
      case NORMAL_MESSAGE: {
        plainText = unpad512BytesMessage(processedMessage, messageByteLength)
        break
      }
      default:
        throw new Error('Unknown message type')
    }

    return new KeymailMessage(header, plainText)
  }
}

module.exports = KeymailMessage
