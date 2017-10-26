const path = require('path')
const fs = require('fs-extra')
const ora = require('ora')

const sodium = require('libsodium-wrappers-sumo')
const Proteus = require('wire-webapp-proteus')

const checkRegister = require('./check-register')
const createAccount = require('./create-account')

const {
  IdentityKeyPair
} = Proteus.keys

const usernamePrompt = [
  {
    type: 'input',
    name: 'username',
    message: 'Username:',
    validate: val => (val ? true : 'Username cannot be empty!')
  }
]

async function handleRegister({
  argv,
  trustbase,
  preKeyStore,
  inquirer,
  web3
}) {
  const username = argv._.length > 1 ? argv._[1] : (await inquirer.prompt(usernamePrompt)).username
  if (username === '') {
    ora().fail('Invalid username')
    process.exit(1)
  }

  const usernameHash = web3.utils.sha3(username)

  const storagePath = argv.storagePath
  const userStoragePath = path.resolve(storagePath, `./${usernameHash}`)
  if ((await fs.exists(userStoragePath))) {
    ora().info(`Found identity for '${username}' locally`)
    process.exit(0)
  }

  const pendingRecordPath = argv.pendingRecordPath
  const pendingRecords = await fs.readJSON(pendingRecordPath)
  if (pendingRecords[username]) {
    await checkRegister({
      argv: {
        _: ['check-register', username]
      },
      inquirer,
      trustbase
    })
    return
  }

  const identityKeyString = await trustbase.getIdentity(username)

  if (Number(identityKeyString) !== 0) {
    ora().fail('Username already registered. Try another account name.')
    process.exit(1)
  }

  const identityKeyPair = IdentityKeyPair.new()

  const transactionSpinner = ora('Creating transaction').start()
  const waitTxSpinner = ora('Waiting for transaction')

  const newIdentityKeyString = identityKeyPair.public_key.fingerprint()

  trustbase.register(username, identityKeyPair.public_key.fingerprint())
    .on('transactionHash', async (transactionHash) => {
      transactionSpinner.succeed(`Transaction created: ${transactionHash}`)
      const recordSpinner = ora('Saving register record').start()
      await fs.writeJSON(pendingRecordPath, {
        ...pendingRecords,
        [username]: {
          keyPair: sodium.to_hex(new Uint8Array(identityKeyPair.serialise())),
          transactionHash
        }
      })
        .then(() => {
          recordSpinner.succeed('Register record saved')
        })
        .catch((err) => {
          recordSpinner.fail('Fail to save record:')
          console.error(err)
          ora().warn('\nIMPORTANT: Please don\'t exit before registration completed, or you will lose your account!')
        })

      waitTxSpinner.start()
    })
    .on('confirmation', async (confirmationNumber) => {
      if (confirmationNumber === 3) {
        await fs.writeJSON(pendingRecordPath, pendingRecords)
        const registeredIdentityKeyString = await trustbase.getIdentity(username)
        if (registeredIdentityKeyString === `0x${newIdentityKeyString}`) {
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
    })
    .on('error', async (err) => {
      await fs.writeJSON(pendingRecordPath, pendingRecords)
      transactionSpinner.fail('Unexpected error:')
      console.error(err.message)
      process.exit(1)
    })
}

module.exports = handleRegister
