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
  unpad512BytesMessage
} = require('./utils')

const PRE_KEY_ID_BYTES_LENGTH = 2

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
    const senderUsernameHash = message.senderUserHash
    console.log(`${new Date(message.timestamp * 1000)} - ${contacts[senderUsernameHash] || `Stranger(${usernameHash})`}: ${message.message}`)
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
  let fromUsernameHash
  if (fromUser) {
    const isHash = fromUser.startsWith('0x')
      ? fromUser === `0x${Number(fromUser).toString(16)}`
      : fromUser === `${Number(`0x${fromUser}`).toString(16)}`
    fromUsernameHash = isHash ? fromUser : web3.utils.sha3(fromUser)
  }
  const filteredReceivedMessages = fromUsernameHash
    ? receivedMessages.filter(({ senderUserHash }) => senderUserHash === fromUsernameHash)
    : receivedMessages

  filteredReceivedMessages.forEach(displayMessage)

  const currentBlock = await web3.eth.getBlockNumber()
  if (currentBlock <= lastBlock + 3) {
    ora().succeed('Inbox is up to date')
    process.exit(0)
  }

  async function deserializeHelloMessage({
    message,
    timestamp,
    senderUserHash
  }) {
    // if something went wrong, just throw and drop the message
    const {
      message: actualMessage,
      username: helloFromUsername
    } = JSON.parse(message)

    const helloFromUsernameHash = web3.utils.sha3(helloFromUsername)

    if (helloFromUsernameHash !== senderUserHash) {
      throw new Error('Invalid hello message')
    }

    if (Object.keys(contacts).length === 0) {
      await fs.writeJSON(userContactsPath, {
        [senderUserHash]: helloFromUsername
      })
    } else if (!contacts[senderUserHash]) {
      await fs.writeJSON(userContactsPath, {
        ...contacts,
        [senderUserHash]: helloFromUsername
      })
    }
    contacts[senderUserHash] = helloFromUsername
    return {
      message: actualMessage,
      timestamp,
      senderUserHash
    }
  }

  function deserializeMessage({
    message,
    senderUserHash,
    messageType,
    timestamp,
    messageByteLength
  }) {
    const unpaddedMessage = unpad512BytesMessage(message, messageByteLength)
    // hello message
    if (messageType === 0) {
      return deserializeHelloMessage({
        message: unpaddedMessage,
        timestamp,
        senderUserHash
      })
    }
    return {
      message: unpaddedMessage,
      timestamp,
      senderUserHash
    }
  }

  async function decryptMessage({
    message,
    senderUserHash,
    timestamp
  }) {
    const identityKeyString = await trustbase.getIdentity(senderUserHash, { isHash: true })
    const theirIdentityKey = identityKeyFromHexStr(identityKeyString.slice(2))
    const concatedBuf = sodium.from_hex(message.slice(2)) // Uint8Array
    const preKeyID = new Uint16Array(concatedBuf.slice(0, PRE_KEY_ID_BYTES_LENGTH).buffer)[0]
    const preKey = await fileStore.load_prekey(preKeyID)
    const myEnvelope = MyEnvelope.decrypt(
      concatedBuf.slice(PRE_KEY_ID_BYTES_LENGTH),
      preKey,
      theirIdentityKey
    )
    const proteusEnvelope = getEmptyEnvelope()
    const {
      mac,
      baseKey,
      identityKey,
      isPreKeyMessage,
      messageType,
      messageByteLength
    } = myEnvelope.header
    proteusEnvelope.mac = mac
    proteusEnvelope._message_enc = (() => {
      if (isPreKeyMessage) {
        return new Uint8Array(Proteus.message.PreKeyMessage.new(
          preKeyID,
          baseKey,
          identityKey,
          myEnvelope.cipherMessage
        ).serialise())
      }
      return new Uint8Array(myEnvelope.cipherMessage.serialise())
    })()
    return box.decrypt(
      senderUserHash,
      proteusEnvelope.serialise()
    )
      .then(decryptedMessage => deserializeMessage({
        message: decryptedMessage,
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
    } = await messages.getMessages(['keymail'], _lastBlock > 0 ? {
      fromBlock: _lastBlock
    } : undefined)

    const newReceivedMessages = (await Promise.all(allNewMessages
      .map(message => decryptMessage(message).catch(() => null))))
      .filter(m => m !== null)


    receivedMessages.push(...newReceivedMessages)

    await fs.writeJSON(inboxPath, {
      lastBlock: newLastBlock,
      messages: receivedMessages
    })

    return {
      newLastBlock,
      newReceivedMessages: fromUser
        ? newReceivedMessages.filter(({ senderUserHash }) => senderUserHash === fromUsernameHash)
        : newReceivedMessages
    }
  }

  if (argv.watch) {
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

        if (newReceivedMessages.length > 0) {
          fetchingSpinner.stop()
          newReceivedMessages.forEach(displayMessage)
          fetchingSpinner = ora('Fetching messages persistently...').start()
        }

        setTimeout(fetchNewMessagesLoop, 3000)
      } catch (err) {
        console.log(err)
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

    newReceivedMessages.forEach(displayMessage)

    process.exit(0)
  }
}

module.exports = handleInbox
