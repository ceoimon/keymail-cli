const path = require('path')
const fs = require('fs-extra')
const ora = require('ora')

const sodium = require('libsodium-wrappers-sumo')

const Cryptobox = require('wire-webapp-cryptobox')
const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')

const fuzzy = require('fuzzy')

const MyCRUDStore = require('./MyCRUDStore')
const MyPreKeyBundle = require('./MyPreKeyBundle')
const {
  unixToday,
  publicKeyFromHexStr,
  identityKeyFromHexStr
} = require('./utils')

async function getPreKeyBundle({
  trustbase,
  preKeyStore,
  username
}) {
  const identityKeyString = await trustbase.getIdentity(username)
  const {
    interval,
    lastPrekeysDate
  } = await preKeyStore.getMetaData(username)

  const bytes32Zero = '0x0000000000000000000000000000000000000000000000000000000000000000'

  let prekeyPublicKeyString = bytes32Zero
  let prekeyID = unixToday()
  if (prekeyID > lastPrekeysDate) {
    prekeyPublicKeyString = await preKeyStore.getPrekey(username, 65535)
    prekeyID = 65535
  } else {
    const limitDay = prekeyID - interval
    while (prekeyID > limitDay && prekeyPublicKeyString === bytes32Zero) {
      // eslint-disable-next-line
      prekeyPublicKeyString = await preKeyStore.getPrekey(username, prekeyID)
      prekeyID -= 1
    }
    prekeyID += 1

    // If not found, use last-resort prekey
    if (prekeyPublicKeyString === bytes32Zero) {
      prekeyPublicKeyString = await preKeyStore.getPrekey(username, 65535)
      prekeyID = 65535
    }
  }

  const prekeyPublicKey = publicKeyFromHexStr(prekeyPublicKeyString.slice(2))
  const identityKey = identityKeyFromHexStr(identityKeyString.slice(2))

  return MyPreKeyBundle.new(identityKey, prekeyPublicKey, prekeyID)
}

async function handleSend({
  argv,
  trustbase,
  preKeyStore,
  messages,
  inquirer,
  web3
}) {
  let fromUsername = argv.from
  let toUsername = argv.to
  let messageIndex = 1
  const recordPath = argv.recordPath
  const record = await fs.readJSON(recordPath)
  const usernames = Object.keys(record)
  if (usernames.length === 0) {
    ora().fail('Seems like You don\'t have any account yet. (use `register` command to register one!)')
    process.exit(0)
  }

  if (!fromUsername) {
    if (argv._.length > 1) {
      fromUsername = argv._[1]
      messageIndex += 1
    } else {
      fromUsername = usernames.length === 1 ? usernames[0] : (await inquirer.prompt([{
        type: 'list',
        name: 'username',
        message: 'Select account:',
        pageSize: 5,
        choices: usernames
      }])).username
    }
  }
  if (!fromUsername || !record[fromUsername]) {
    ora().fail('Invalid account username')
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

  if (!toUsername) {
    if (argv._.length > 1) {
      toUsername = argv.from ? argv._[1] : argv._[2]
      messageIndex += 1
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
  }
  if (!toUsername) {
    ora().fail('Invalid toUsername')
    process.exit(1)
  }
  const toUsernameHash = argv.hash ? toUsername : web3.utils.sha3(toUsername)
  const identityKeyString = await trustbase.getIdentity(toUsernameHash, { isHash: true })
  if (Number(identityKeyString) === 0) {
    ora().fail(`User(${toUsername}) not exist!`)
    process.exit(1)
  }

  let message = argv._[messageIndex]
  if (!message) {
    message = (await inquirer.prompt([{
      type: 'input',
      name: 'message',
      message: 'Message:',
      validate: val => (val ? true : 'Message cannot be empty!')
    }])).message
  }
  if (!message) {
    ora().fail('Invalid message')
    process.exit(1)
  }

  const engine = new FileEngine(userStoragePath)
  const fileStore = new MyCRUDStore(engine)
  const box = new Cryptobox.Cryptobox(fileStore, 0)
  await box.load()

  const preKeyBundle = await getPreKeyBundle({
    trustbase,
    preKeyStore,
    username: toUsername
  })

  // Try to load local session and save to cache..
  await box.session_load(toUsernameHash).catch(() => {})

  const encryptedMessage = await box.encrypt(toUsernameHash, message, preKeyBundle.serialise())
  const sedingSpinner = ora('Sending...').start()
  await messages.publish('proteus', fromUsername, sodium.to_hex(new Uint8Array(encryptedMessage)))
  sedingSpinner.succeed('Sent')

  // save contact
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
  process.exit(0)
}

module.exports = handleSend
