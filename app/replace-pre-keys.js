const fs = require('fs-extra')
const path = require('path')
const ora = require('ora')

const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')

const MyCRUDStore = require('./MyCRUDStore')
const addPreKeys = require('./add-pre-keys')

const {
  getUnixDay,
  unixToday
} = require('./utils')

async function handleInfo({
  argv,
  preKeyStore,
  inquirer
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

  const replaceFromThisDay = getUnixDay(argv.from)

  const {
    interval,
    lastPrekeysDate
  } = await preKeyStore.getMetaData(username)

  const usernameHash = record[username]
  const userStoragePath = path.resolve(argv.storagePath, `./${usernameHash}`)
  await fs.ensureDir(userStoragePath)
  const engine = new FileEngine(userStoragePath)
  const fileStore = new MyCRUDStore(engine)

  if (replaceFromThisDay > lastPrekeysDate) {
    ora().warn('You are not replacing any pre-keys')
    if (lastPrekeysDate > unixToday() + (10 * interval)) {
      ora().succeed('And seems like you have enough pre-keys')
      process.exit(0)
    }
    ora().warn('And seems like you dont have enough pre-keys, start upload new pre-keys')

    await addPreKeys({
      argv: {
        ...argv,
        username,
        fileStore,
        fromUnixDay: lastPrekeysDate + interval
      },
      inquirer,
      preKeyStore
    })
    process.exit(0)
  }

  const preKeysFromStorage = await fileStore.load_prekeys()
  await Promise.all(preKeysFromStorage
    .filter(preKey => Number(preKey.key_id) > replaceFromThisDay)
    .map(preKeyToDelete => fileStore.deletePrekey(preKeyToDelete.key_id)))

  await addPreKeys({
    argv: {
      ...argv,
      username,
      fileStore,
      fromUnixDay: replaceFromThisDay
    },
    inquirer,
    preKeyStore
  })

  process.exit(0)
}

module.exports = handleInfo
