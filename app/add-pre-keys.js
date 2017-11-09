const Proteus = require('proteus-hd')
const ora = require('ora')

const { unixToday } = require('./utils')

const {
  PreKey
} = Proteus.keys

function generatePrekeys(start, interval, size) {
  if (size === 0) {
    return []
  }

  return [...Array(size).keys()]
    .map(x => PreKey.new(((start + (x * interval)) % PreKey.MAX_PREKEY_ID)))
}

async function addPreKeys({
  argv,
  inquirer,
  preKeyStore
}) {
  let {
    preKeyInterval: interval,
    preKeyNumber: numOfPreKeys
  } = argv

  const {
    username,
    fileStore,
    fromUnixDay = unixToday()
  } = argv

  if (!interval) {
    interval = (await inquirer.prompt([{
      type: 'input',
      name: 'interval',
      message: 'Pre-keys interval',
      default: 1,
      validate: value => (isNaN(Number(value)) ? 'Must be a number!' : true)
    }])).interval
  }

  if (!numOfPreKeys) {
    numOfPreKeys = (await inquirer.prompt([{
      type: 'input',
      name: 'numOfPreKeys',
      message: 'Number of pre-keys',
      default: 100,
      validate: value => (isNaN(Number(value)) ? 'Must be a number!' : true)
    }])).numOfPreKeys
  }

  const spinner = ora('Uploading pre-keys').start()

  const preKeys = generatePrekeys(fromUnixDay, interval, numOfPreKeys)
  const preKeysPublicKeys = preKeys.map(preKey => `0x${preKey.key_pair.public_key.fingerprint()}`)
  const lastResortPrekey = PreKey.last_resort() // id is 65535
  lastResortPrekey.key_pair = preKeys[preKeys.length - 1].key_pair
  await fileStore.save_prekeys(preKeys.concat(lastResortPrekey))

  await preKeyStore.uploadPrekeys(username, preKeysPublicKeys, {
    interval,
    fromUnixDay
  })

  spinner.succeed('PreKeys uploaded')
}

module.exports = addPreKeys
