const path = require('path')
const fs = require('fs-extra')

const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')

const addPreKeys = require('./add-pre-keys')
const MyCRUDStore = require('./MyCRUDStore')

async function createAccount({
  argv,
  inquirer,
  preKeyStore
}) {
  const {
    storagePath,
    usernameHash,
    identityKeyPair
  } = argv

  const userStoragePath = path.resolve(storagePath, `./${usernameHash}`)
  await fs.ensureDir(userStoragePath)
  const engine = new FileEngine(userStoragePath)
  const fileStore = new MyCRUDStore(engine)

  await fileStore.save_identity(identityKeyPair)

  await addPreKeys({
    argv: {
      ...argv,
      fileStore
    },
    inquirer,
    preKeyStore
  })
}

module.exports = createAccount
