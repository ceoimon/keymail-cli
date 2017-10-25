const fs = require('fs-extra')
const path = require('path')
const ora = require('ora')
const fuzzy = require('fuzzy')

const sodium = require('libsodium-wrappers-sumo')
const Proteus = require('wire-webapp-proteus')

const createAccount = require('./create-account')

const {
  IdentityKeyPair
} = Proteus.keys

async function handleCheckRegister({
  argv,
  trustbase,
  preKeyStore,
  inquirer,
  web3
}) {
  let username = ''

  const pendingRecordPath = argv.pendingRecordPath
  const pendingRecords = await fs.readJSON(pendingRecordPath)

  const pendingRecordUsernames = Object.keys(pendingRecords)

  const hash = argv.hash
  if (hash) {
    username = pendingRecordUsernames.find(name => pendingRecords[name].hash === hash)
    if (!username) {
      ora().fail(`Register record for transaction(${hash}) was not found on your machine`)
      process.exit(0)
    }
  } else if (argv._.length > 1) {
    username = argv._[1]
  } else if (pendingRecordUsernames.length === 1) {
    username = pendingRecordUsernames[0]
  } else if (pendingRecordUsernames.length > 0) {
    const searchPendingRecordUsername = async (_, input = '') => {
      if (!input) return pendingRecordUsernames
      const fuzzyResult = fuzzy.filter(input, pendingRecordUsernames)
      return fuzzyResult.map(e => e.original)
    }

    username = (await inquirer.prompt([{
      type: 'autocomplete',
      name: 'username',
      message: 'Select username:',
      source: searchPendingRecordUsername,
      pageSize: 5
    }])).username
  } else {
    ora().fail('No register record found')
    process.exit(0)
  }

  const usernameHash = web3.utils.sha3(username)
  const storagePath = argv.storagePath
  const userStoragePath = path.resolve(storagePath, `./${usernameHash}`)
  if ((await fs.exists(userStoragePath))) {
    ora().info(`Found identity for '${username}' locally`)
    process.exit(0)
  }

  if (!pendingRecords[username]) {
    ora().warn(`Register record for '${username}' was not found on your machine`)
    const identityKeyString = await trustbase.getIdentity(username)
    if (Number(identityKeyString) === 0) {
      ora().info(`Lucky! '${username}' has not been registered!(you can use \`register\` command to register)`)
    } else {
      ora().info(`And '${username}' is already registered :(`)
    }
    process.exit(0)
  }

  const transactionHash = hash || pendingRecords[username].transactionHash

  const {
    keyPair: keyPairHexString
  } = pendingRecords[username]
  const identityKeyPair = IdentityKeyPair.deserialise(sodium.from_hex(keyPairHexString).buffer)

  const waitTxSpinner = ora('Waiting for transaction')
  waitTxSpinner.start()

  const waitForTransactionReceipt = async () => {
    const receipt = await web3.eth.getTransactionReceipt(transactionHash)
    if (receipt !== null) {
      delete pendingRecords[username]
      await fs.writeJSON(pendingRecordPath, pendingRecords)
      if (receipt.logs.length > 0) {
        waitTxSpinner.succeed('Registration success!')

        await createAccount({
          argv: {
            ...argv,
            username,
            usernameHash,
            identityKeyPair
          },
          inquirer,
          preKeyStore
        })

        const recordPath = argv.recordPath
        const record = await fs.readJSON(recordPath)
        record[username] = usernameHash
        await fs.writeJSON(recordPath, record)
        ora().succeed(`Account(${username}) created`)
      } else {
        waitTxSpinner.fail('Username already registered. Try another account name.')
      }
      process.exit(0)
    }

    setTimeout(waitForTransactionReceipt, 1000)
  }

  await waitForTransactionReceipt()
}

module.exports = handleCheckRegister
