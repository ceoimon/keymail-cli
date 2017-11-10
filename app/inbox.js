const fs = require('fs-extra')
const path = require('path')
const ora = require('ora')

const Proteus = require('wire-webapp-proteus')

const Cryptobox = require('wire-webapp-cryptobox')
const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')
const sodium = require('libsodium-wrappers')

const MyCRUDStore = require('./MyCRUDStore')
const MyEnvelope = require('./MyEnvelope')

const {
  getEmptyEnvelope,
  identityKeyFromHexStr,
  unpad512BytesMessage,
  unixToday
} = require('./utils')

const {
  PRE_KEY_ID_BYTES_LENGTH,
  MESSAGE_TYPES: {
    HELLO_MESSAGE,
    NORMAL_MESSAGE
  }
} = require('./constants')

async function handleInbox({
  argv,
  messages,
  inquirer,
  trustbase,
  web3
}) {
  const recordPath = argv.recordPath
  const record = await fs.readJSON(recordPath)
  const usernames = Object.keys(record)
  if (usernames.length === 0) {
    ora().fail('Seems like You don\'t have any account yet. (use `register` command to register one!)')
    process.exit(0)
  }

  let username = argv._[1] || argv.use || argv.user || argv.currentUser || ''

  if (username.length === 0) {
    username = usernames.length === 1 ? usernames[0] : (await inquirer.prompt([{
      type: 'list',
      name: 'username',
      message: 'Select account:',
      pageSize: 5,
      choices: usernames
    }])).username
  } else {
    ora().info(`Using account: ${username}`)
  }

  if (username === '') {
    ora().fail('Invalid username.')
    process.exit(1)
  }

  if (!record[username] || !await trustbase.isOwner(web3.eth.defaultAccount, username)) {
    ora().fail('Invalid username, you don\'t own this username.')
    process.exit(1)
  }

  const usernameHash = web3.utils.sha3(username)
  const userStoragePath = path.resolve(argv.storagePath, `./${usernameHash}`)
  const userContactsPath = path.resolve(userStoragePath, './contacts.json')
  let contacts = {}
  if (!await fs.exists(userContactsPath)) {
    await fs.ensureFile(userContactsPath)
    await fs.writeJSON(userContactsPath, contacts)
  } else {
    contacts = await fs.readJSON(userContactsPath)
  }

  function displayMessage(message) {
    if (!message.timestamp || !message.fromUsername || !message.plainText) return
    console.log(`${new Date(message.timestamp * 1000)} - ${message.fromUsername}: ${message.plainText}`)
  }

  const engine = new FileEngine(userStoragePath)
  const fileStore = new MyCRUDStore(engine)
  const box = new Cryptobox.Cryptobox(fileStore, 0)
  await box.load()

  const inboxPath = path.resolve(userStoragePath, 'inbox.json')
  const isInboxRecordExist = await fs.exists(inboxPath)
  if (!isInboxRecordExist) {
    await fs.ensureFile(inboxPath)
    await fs.writeJSON(inboxPath, {})
  }

  const {
    lastBlock = 0,
    messages: receivedMessages = []
  } = isInboxRecordExist ? await fs.readJSON(inboxPath) : {}

  const fromUser = argv.from
  let filterFromUsernameHash
  if (fromUser) {
    const isHash = fromUser.startsWith('0x')
      ? fromUser === `0x${Number(fromUser).toString(16)}`
      : fromUser === `${Number(`0x${fromUser}`).toString(16)}`
    filterFromUsernameHash = isHash ? fromUser : web3.utils.sha3(fromUser)
  }
  const filteredReceivedMessages = filterFromUsernameHash
    ? receivedMessages.filter(({ senderUserHash }) => senderUserHash === filterFromUsernameHash)
    : receivedMessages

  filteredReceivedMessages.forEach(displayMessage)

  const currentBlock = await web3.eth.getBlockNumber()
  if (currentBlock <= lastBlock + 3) {
    ora().succeed('Inbox is up to date')
    process.exit(0)
  }

  async function saveContact(senderUserHash, fromUsername) {
    if (!contacts[senderUserHash]) {
      contacts[senderUserHash] = fromUsername
      await fs.writeJSON(userContactsPath, contacts)
    }
  }

  async function deserializeMessage({
    decryptedPaddedMessage,
    senderUserHash,
    messageType,
    timestamp,
    messageByteLength
  }) {
    const unpaddedMessage = unpad512BytesMessage(decryptedPaddedMessage, messageByteLength)
    const {
      fromUsername,
      plainText
    } = JSON.parse(unpaddedMessage)

    const fromUsernameHash = web3.utils.sha3(fromUsername)

    if (fromUsernameHash !== senderUserHash) {
      throw new Error('Invalid message, username hash not match')
    }

    switch (messageType) {
      case HELLO_MESSAGE:
        await saveContact(senderUserHash, fromUsername)
        break
      case NORMAL_MESSAGE:
        break
      default:
        throw new Error('Unknown message type')
    }

    return {
      timestamp,
      fromUsername,
      plainText
    }
  }

  async function decryptMessage({
    message: encryptedConcatedBufferStr,
    timestamp
  }) {
    const concatedBuf = sodium.from_hex(encryptedConcatedBufferStr.slice(2)) // Uint8Array
    const preKeyID = new Uint16Array(concatedBuf.slice(0, PRE_KEY_ID_BYTES_LENGTH).buffer)[0]
    const preKey = await fileStore.load_prekey(preKeyID)
    const myEnvelope = MyEnvelope.decrypt(
      concatedBuf.slice(PRE_KEY_ID_BYTES_LENGTH),
      preKey
    )

    const proteusEnvelope = getEmptyEnvelope()
    const {
      mac,
      baseKey,
      senderUserHash,
      isPreKeyMessage,
      messageType,
      messageByteLength
    } = myEnvelope.header
    const identityKeyString = await trustbase.getIdentity(senderUserHash, { isHash: true })
    const theirIdentityKey = identityKeyFromHexStr(identityKeyString.slice(2))

    proteusEnvelope.mac = mac
    proteusEnvelope._message_enc = (() => {
      if (isPreKeyMessage) {
        return new Uint8Array(Proteus.message.PreKeyMessage.new(
          preKeyID,
          baseKey,
          theirIdentityKey,
          myEnvelope.cipherMessage
        ).serialise())
      }
      return new Uint8Array(myEnvelope.cipherMessage.serialise())
    })()

    await box.session_load(senderUserHash).catch((err) => {
      if (err.name !== 'RecordNotFoundError') {
        // we have a corrupted session (old version) on local
        const sessionStorePath = path.join(userStoragePath, 'sessions', `${senderUserHash}.dat`)
        return fs.remove(sessionStorePath).then(() => null).catch((removeErr) => {
          console.error(removeErr)
          process.exit(1)
        })
      }
      return null
    })

    return box.decrypt(
      senderUserHash,
      proteusEnvelope.serialise()
    )
      .then(decryptedPaddedMessage => deserializeMessage({
        decryptedPaddedMessage,
        timestamp,
        senderUserHash,
        messageType,
        messageByteLength
      }))
  }

  async function fetchNewMessages(_lastBlock = lastBlock) {
    const {
      lastBlock: newLastBlock,
      messages: allNewMessages
    } = await messages.getMessages({
      fromBlock: _lastBlock > 0 ? _lastBlock : 0
    })

    const newReceivedMessages = (await Promise.all(allNewMessages
      .map(messageObj => decryptMessage(messageObj).catch(() => null))))
      .filter(m => m !== null)


    receivedMessages.push(...newReceivedMessages)

    await fs.writeJSON(inboxPath, {
      lastBlock: newLastBlock,
      messages: receivedMessages
    })

    return {
      newLastBlock,
      newReceivedMessages: fromUser
        ? newReceivedMessages
          .filter(({ senderUserHash }) => senderUserHash === filterFromUsernameHash)
        : newReceivedMessages
    }
  }

  async function deleteOutdatedPreKeys() {
    const preKeysFromStorage = await fileStore.load_prekeys()
    const _unixToday = unixToday()
    await Promise.all(preKeysFromStorage
      .filter(preKey => Number(preKey.key_id) < _unixToday)
      .map(preKeyToDelete => fileStore.deletePrekey(preKeyToDelete.key_id)))
  }

  if (argv.watch) {
    let deletedOutdatedPrekey = false
    let fetchingSpinner = ora('Fetching messages persistently...').start()
    let newFetchingLastBlock = lastBlock
    setTimeout(async function fetchNewMessagesLoop() {
      const currentBlockNumber = await web3.eth.getBlockNumber()
      if (currentBlockNumber === newFetchingLastBlock) {
        setTimeout(fetchNewMessagesLoop, 3000)
        return
      }

      try {
        const {
          newReceivedMessages,
          newLastBlock
        } = await fetchNewMessages(newFetchingLastBlock)
        newFetchingLastBlock = newLastBlock

        if (!deletedOutdatedPrekey) {
          await deleteOutdatedPreKeys()
          deletedOutdatedPrekey = true
        }

        if (newReceivedMessages.length > 0) {
          fetchingSpinner.stop()
          newReceivedMessages.forEach(displayMessage)
          fetchingSpinner = ora('Fetching messages persistently...').start()
        }

        setTimeout(fetchNewMessagesLoop, 3000)
      } catch (err) {
        console.warn(err.message)
        setTimeout(fetchNewMessagesLoop, 3000)
      }
    }, 3000)
  } else {
    const fetchingSpinner = ora('Fetching new messages...').start()

    const { newReceivedMessages } = await fetchNewMessages()

    const newMessagesNum = newReceivedMessages.length
    fetchingSpinner.succeed(newMessagesNum > 0
      ? `Fetched ${newMessagesNum} new message(s)`
      : 'Inbox is up to date')

    await deleteOutdatedPreKeys()

    newReceivedMessages.forEach(displayMessage)

    process.exit(0)
  }
}

module.exports = handleInbox
