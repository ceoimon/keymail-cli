const fs = require('fs-extra')
const path = require('path')
const ora = require('ora')

const sodium = require('libsodium-wrappers-sumo')

const Cryptobox = require('wire-webapp-cryptobox')
const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')

const MyCRUDStore = require('./MyCRUDStore')

function displayMessages(messages, contacts) {
  messages.forEach((message) => {
    const usernameHash = message.senderUserHash
    console.log(`${new Date(message.timestamp * 1000)} - ${contacts[usernameHash] || `Stranger(${usernameHash})`}: ${message.message}`)
  })
}

async function handleInbox({
  argv,
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

  let username = argv._[1]
  if (!username) {
    username = usernames.length === 1 ? usernames[0] : (await inquirer.prompt([{
      type: 'list',
      name: 'username',
      message: 'Select account:',
      pageSize: 5,
      choices: usernames
    }])).username
  }

  if (!username || !record[username]) {
    ora().fail('Invalid username')
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
    lastBlock,
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

  displayMessages(filteredReceivedMessages, contacts)

  const currentBlock = await web3.eth.getBlockNumber()
  if (currentBlock <= lastBlock) {
    ora().succeed('Your inbox is up to date')
    process.exit(0)
  }

  const fetchingSpinner = ora('Fetching new messages...').start()
  const {
    lastBlock: newLastBlock,
    messages: allNewMessages
  } = await messages.getMessages('proteus', {
    fromBlock: lastBlock || 0
  })

  const newReceivedMessages = (await Promise.all(allNewMessages.map(({
    message,
    senderUserHash,
    timestamp
  }) => box.decrypt(
    senderUserHash,
    sodium.from_hex(message.slice(2)).buffer
  )
    .then(decryptedMessage => ({
      message: sodium.to_string(decryptedMessage),
      senderUserHash,
      timestamp
    }))
    .catch(() => null)))
  )
    .filter(m => m !== null)

  const newMessagesNum = newReceivedMessages.length
  fetchingSpinner.succeed(newMessagesNum > 0
    ? `Fetched ${newMessagesNum} new message(s)`
    : 'Your inbox is up to date')

  const newFilteredReceivedMessages = fromUser
    ? newReceivedMessages.filter(({ senderUserHash }) => senderUserHash === fromUsernameHash)
    : newReceivedMessages

  displayMessages(newFilteredReceivedMessages, contacts)

  await fs.writeJSON(inboxPath, {
    lastBlock: newLastBlock > lastBlock ? newLastBlock : lastBlock,
    messages: receivedMessages.concat(newReceivedMessages)
  })

  process.exit(0)
}

module.exports = handleInbox
