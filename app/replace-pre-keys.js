const fs = require('fs-extra')
const path = require('path')
const ora = require('ora')

const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')

const uploadPreKeys = require('./upload-pre-keys')
const MyCRUDStore = require('./MyCRUDStore')

const {
  getPreKeys,
  unixToday
} = require('./utils')

async function handleReplacePreKeys({
  argv,
  inquirer,
  trustbaseIdentities,
  trustbasePreKeys,
  web3
}) {
  const recordPath = argv.recordPath
  const record = await fs.readJSON(recordPath)
  const usernames = Object.keys(record)
  if (usernames.length === 0) {
    ora().fail('Seems like You don\'t have any account yet. (use `register` command to register one!)')
    process.exit(0)
  }

  let username = argv._[1] || argv.use || argv.user || argv.currentUser
  if (!username) {
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

  if (!username) {
    ora().fail('Invalid username.')
    process.exit(1)
  }

  if (!record[username] || !await trustbaseIdentities.isOwner(username, web3.eth.defaultAccount)) {
    ora().fail('Invalid username, you don\'t own this username.')
    process.exit(1)
  }

  const {
    interval,
    lastPrekeysDate
  } = await getPreKeys({
    trustbasePreKeys,
    usernameOrusernameHash: username
  }).catch((err) => {
    console.warn('Unexpected error happen when trying to retrieve pre-keys')
    console.error(err)
    process.exit(1)
  })

  const usernameHash = record[username]
  const userStoragePath = path.resolve(argv.storagePath, `./${usernameHash}`)
  await fs.ensureDir(userStoragePath)
  const engine = new FileEngine(userStoragePath)
  const fileStore = new MyCRUDStore(engine)

  const today = unixToday()

  if (today > lastPrekeysDate) {
    ora().warn('You are not replacing any pre-keys')
    if (argv.autoRefill
      && lastPrekeysDate < unixToday() + (argv.refillLimit * interval)
    ) {
      ora().warn('It seems like you dont have enough pre-keys, start upload new pre-keys')

      await uploadPreKeys({
        argv: {
          ...argv,
          username,
          fileStore
        },
        inquirer,
        trustbasePreKeys
      })
    }
    process.exit(0)
  }

  const preKeysFromStorage = await fileStore.load_prekeys()
  await Promise.all(preKeysFromStorage
    .filter(preKey => Number(preKey.key_id) >= today)
    .map(preKeyToDelete => fileStore.deletePrekey(preKeyToDelete.key_id)))

  await uploadPreKeys({
    argv: {
      ...argv,
      username,
      fileStore
    },
    inquirer,
    trustbasePreKeys
  })

  process.exit(0)
}

module.exports = handleReplacePreKeys
