const path = require('path')
const fs = require('fs-extra')
const ora = require('ora')

const Proteus = require('wire-webapp-proteus')
const Cryptobox = require('wire-webapp-cryptobox')
const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')

const fuzzy = require('fuzzy')

const MyCRUDStore = require('./MyCRUDStore')
const MyEnvelope = require('./MyEnvelope')
const uploadPreKeys = require('./upload-pre-keys')
const {
  getPreKey,
  getPreKeys,
  unixToday,
  getPreKeyBundle,
  padTo512Bytes
} = require('./utils')

const {
  MESSAGE_TYPES: {
    HELLO_MESSAGE,
    NORMAL_MESSAGE
  }
} = require('./constants')

async function handleSend({
  argv,
  trustbaseIdentities,
  trustbasePreKeys,
  trustbaseMessages,
  inquirer,
  web3
}) {
  const recordPath = argv.recordPath
  const record = await fs.readJSON(recordPath)
  const usernames = Object.keys(record)
  if (usernames.length === 0) {
    ora().fail('Seems like You don\'t have any account yet. (use `register` command to register one!)')
    process.exit(0)
  }

  let fromUsername = argv.use || argv.user || argv.currentUser || ''

  if (fromUsername.length === 0) {
    fromUsername = usernames.length === 1 ? usernames[0] : (await inquirer.prompt([{
      type: 'list',
      name: 'username',
      message: 'Select account:',
      pageSize: 5,
      choices: usernames
    }])).username
  } else {
    ora().info(`Using account: ${fromUsername}`)
  }

  if (fromUsername.length === 0) {
    ora().fail('Invalid username.')
    process.exit(1)
  }
  if (!record[fromUsername]
    || !await trustbaseIdentities.isOwner(fromUsername, web3.eth.defaultAccount)
  ) {
    ora().fail('Invalid username, you don\'t own this account.')
    process.exit(1)
  }

  const fromUsernameHash = web3.utils.sha3(fromUsername)

  const userStoragePath = path.resolve(argv.storagePath, `./${fromUsernameHash}`)
  const userContactsPath = path.resolve(userStoragePath, './contacts.json')

  let contacts = {}
  let contactNames = []
  if (!await fs.exists(userContactsPath)) {
    await fs.ensureFile(userContactsPath)
    await fs.writeJSON(userContactsPath, {})
  } else {
    contacts = await fs.readJSON(userContactsPath)
    contactNames = Object.values(contacts)
  }

  async function searchContacts(_, input = '') {
    if (!input) return contactNames
    const fuzzyResult = fuzzy.filter(input, contactNames)
    return fuzzyResult.map(e => e.original)
  }

  let toUsername = ''
  if (argv._.length > 1) {
    toUsername = argv._[1]
  } else if (contactNames.length === 0) {
    toUsername = (await inquirer.prompt([{
      type: 'input',
      name: 'username',
      message: 'Recipient:',
      validate: val => (val ? true : 'Recipient cannot be empty!')
    }])).username
  } else {
    toUsername = (await inquirer.prompt([{
      type: 'autocomplete',
      name: 'username',
      suggestOnly: true,
      message: 'Recipient:',
      source: searchContacts,
      pageSize: 5,
      noResultText: 'Press Enter to start a new conversation with him!',
      validate: val => (val ? true : 'Recipient cannot be empty!')
    }])).username
  }

  if (toUsername.length === 0) {
    ora().fail('Invalid toUsername')
    process.exit(1)
  }
  const toUsernameHash = argv.hash ? toUsername : web3.utils.sha3(toUsername)
  const {
    publicKey: identityKeyString
  } = await trustbaseIdentities.getIdentity(toUsernameHash, { isHash: true })
  if (Number(identityKeyString) === 0) {
    ora().fail(`User(${toUsername}) not exist!`)
    process.exit(1)
  }

  let message = argv._.length > 2 ? argv._[2] : ''
  if (message.length === 0) {
    message = (await inquirer.prompt([{
      type: 'input',
      name: 'message',
      message: 'Message:',
      validate: val => (val ? true : 'Message cannot be empty!')
    }])).message
  }

  if (message.length === 0) {
    ora().fail('Message cannot be empty!')
    process.exit(1)
  }

  const engine = new FileEngine(userStoragePath)
  const fileStore = new MyCRUDStore(engine)
  const box = new Cryptobox.Cryptobox(fileStore, 0)
  await box.load()


  // Try to load local session and save to cache..
  const session = await box.session_load(toUsernameHash).catch((err) => {
    if (err.name !== 'RecordNotFoundError') {
      // we have a corrupted session (old version) on local
      const sessionStorePath = path.join(userStoragePath, 'sessions', `${toUsernameHash}.dat`)
      return fs.remove(sessionStorePath).then(() => null).catch((removeErr) => {
        console.error(removeErr)
        process.exit(1)
      })
    }
    return null
  })

  const {
    interval,
    lastPrekeysDate,
    preKeyPublicKeys
  } = await getPreKeys({
    trustbasePreKeys,
    usernameOrusernameHash: toUsernameHash,
    isHash: true
  }).catch((err) => {
    console.warn('Unexpected error happen when trying to retrieve pre-keys')
    console.error(err)
    process.exit(1)
  })

  const {
    id: preKeyID,
    publicKey: preKeyPublicKey
  } = await getPreKey({
    interval,
    lastPrekeysDate,
    preKeyPublicKeys
  })

  if (!session) {
    const preKeyBundle = await getPreKeyBundle({
      trustbaseIdentities,
      usernameHash: toUsernameHash,
      preKeyID,
      preKeyPublicKey
    })

    const {
      result: paddedMessage,
      messageByteLength
    } = padTo512Bytes(JSON.stringify({
      fromUsername,
      plainText: message
    }))

    const encryptedMessage = await box.encrypt(
      toUsernameHash,
      paddedMessage,
      preKeyBundle.serialise()
    )
    const envelope = Proteus.message.Envelope.deserialise(encryptedMessage)
    const preKeyMessage = envelope.message
    const cipherMessage = preKeyMessage.message
    const header = {
      mac: envelope.mac, // envelope signature
      baseKey: preKeyMessage.base_key,
      senderUserHash: fromUsernameHash,
      isPreKeyMessage: true,
      messageType: HELLO_MESSAGE,
      messageByteLength
    }

    const myEnvelope = new MyEnvelope(header, cipherMessage)
    const sedingSpinner = ora('Sending...').start()
    await trustbaseMessages.publish(`0x${myEnvelope.encrypt(preKeyID, preKeyPublicKey)}`)
    sedingSpinner.succeed('Sent')

    // save contact
    if (!argv.hash) {
      if (!contacts[toUsernameHash]) {
        contacts[toUsernameHash] = toUsername
        await fs.writeJSON(userContactsPath, contacts)
      }
    }
  } else {
    const {
      result: paddedMessage,
      messageByteLength
    } = padTo512Bytes(JSON.stringify({
      fromUsername,
      plainText: message
    }))

    const encryptedMessage = await box.encrypt(
      toUsernameHash,
      paddedMessage
    )
    const envelope = Proteus.message.Envelope.deserialise(encryptedMessage)

    const myEnvelope = (() => {
      if (envelope.message instanceof Proteus.message.PreKeyMessage) {
        const preKeyMessage = envelope.message
        const cipherMessage = preKeyMessage.message
        const header = {
          mac: envelope.mac, // envelope signature
          baseKey: preKeyMessage.base_key,
          senderUserHash: fromUsernameHash,
          isPreKeyMessage: true,
          messageType: NORMAL_MESSAGE,
          messageByteLength
        }

        return new MyEnvelope(header, cipherMessage)
      }

      const cipherMessage = envelope.message
      const header = {
        mac: envelope.mac, // envelope signature
        baseKey: Proteus.keys.KeyPair.new().public_key, // generate a new one
        senderUserHash: fromUsernameHash,
        isPreKeyMessage: false,
        messageType: NORMAL_MESSAGE,
        messageByteLength
      }

      return new MyEnvelope(header, cipherMessage)
    })()
    const sedingSpinner = ora('Sending...').start()
    await trustbaseMessages.publish(`0x${myEnvelope.encrypt(preKeyID, preKeyPublicKey)}`)
    sedingSpinner.succeed('Sent')
  }

  if (argv.autoRefill && lastPrekeysDate < unixToday() + (argv.refillLimit * interval)) {
    ora().warn('It seems like you dont have enough pre-keys, start upload new pre-keys')

    await uploadPreKeys({
      argv: {
        ...argv,
        username: fromUsername,
        fileStore
      },
      inquirer,
      trustbasePreKeys
    })
  }

  process.exit(0)
}

module.exports = handleSend
