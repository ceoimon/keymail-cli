const path = require('path')
const fs = require('fs-extra')
const ora = require('ora')

const Cryptobox = require('cryptobox-hd')
const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')
const sodium = require('libsodium-wrappers')

const fuzzy = require('fuzzy')

const MyCRUDStore = require('./MyCRUDStore')
const KeymailMessage = require('./KeymailMessage')
const {
  getPreKeyBundle,
  unixToday
} = require('./utils')

const {
  MESSAGE_TYPES: {
    HELLO_MESSAGE,
    NORMAL_MESSAGE
  }
} = require('./constants')

async function handleSend({
  argv,
  trustbase,
  preKeyStore,
  messages,
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
  }

  if (fromUsername.length === 0) {
    ora().fail('Invalid username.')
    process.exit(1)
  }
  if (!record[fromUsername] || !await trustbase.isOwner(web3.eth.defaultAccount, fromUsername)) {
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
  const identityKeyString = await trustbase.getIdentity(toUsernameHash, { isHash: true })
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
    if (err.name === 'DecodeError' && err.message === 'Unexpected type') {
      // we have a corrupted session (old version) on local
      const sessionStorePath = path.join(userStoragePath, 'sessions', toUsernameHash)
      return fs.remove(sessionStorePath).then(() => null).catch((removeErr) => {
        console.error(removeErr)
        process.exit(1)
      })
    }
    return null
  })

  if (!session) {
    const preKeyBundle = await getPreKeyBundle({
      trustbase,
      preKeyStore,
      usernameHash: toUsernameHash
    })
    // new conversation, send 'hello message'
    const messageToSend = new KeymailMessage({
      fromUsername,
      messageType: HELLO_MESSAGE
    }, message)

    const encryptedMessage = await box.encrypt(
      toUsernameHash,
      new Uint8Array(messageToSend.serialise()),
      preKeyBundle.serialise()
    )

    const sedingSpinner = ora('Sending...').start()
    await messages.publish('keymail', fromUsername, `0x${sodium.to_hex(new Uint8Array(encryptedMessage))}`)
    sedingSpinner.succeed('Sent')

    // save contact
    if (!argv.hash) {
      if (contactNames.length === 0) {
        await fs.writeJSON(userContactsPath, {
          [toUsernameHash]: toUsername
        })
      } else if (!contacts[toUsernameHash]) {
        await fs.writeJSON(userContactsPath, {
          ...contacts,
          [toUsernameHash]: toUsername
        })
      }
    }
  } else {
    const messageToSend = new KeymailMessage({
      messageType: NORMAL_MESSAGE
    }, message)

    const encryptedMessage = await box.encrypt(
      toUsernameHash,
      new Uint8Array(messageToSend.serialise()),
      null,
      unixToday()
    )

    const sedingSpinner = ora('Sending...').start()
    await messages.publish('keymail', fromUsername, `0x${sodium.to_hex(new Uint8Array(encryptedMessage))}`)
    sedingSpinner.succeed('Sent')
  }

  process.exit(0)
}

module.exports = handleSend
