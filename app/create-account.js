const path = require('path')
const fs = require('fs-extra')

const { StoreEngine: { FileEngine } } = require('@wireapp/store-engine')

const uploadPreKeys = require('./upload-pre-keys')
const MyCRUDStore = require('./MyCRUDStore')

async function createAccount({
  argv,
  inquirer,
  trustbasePreKeys
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

  await uploadPreKeys({
    argv: {
      ...argv,
      fileStore
    },
    inquirer,
    trustbasePreKeys
  })
}

module.exports = createAccount
