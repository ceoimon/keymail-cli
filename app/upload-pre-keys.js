const Proteus = require('wire-webapp-proteus')
const ora = require('ora')

const sodium = require('libsodium-wrappers')

const { unixToday } = require('./utils')
const PreKeysPackage = require('./PreKeysPackage')

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

async function uploadPreKeys({
  argv,
  inquirer,
  trustbasePreKeys
}) {
  let {
    preKeyInterval: interval,
    preKeyNumber: numOfPreKeys
  } = argv

  const {
    username,
    fileStore
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

  const preKeys = generatePrekeys(unixToday(), interval, numOfPreKeys)
  const preKeysPublicKeys = preKeys.reduce((result, preKey) => Object.assign(result, {
    [preKey.key_id]: `0x${preKey.key_pair.public_key.fingerprint()}`
  }), {})
  const lastResortPrekey = PreKey.last_resort() // id is 65535
  const lastPreKey = preKeys[preKeys.length - 1]
  lastResortPrekey.key_pair = lastPreKey.key_pair
  const preKeysPackage = new PreKeysPackage(preKeysPublicKeys, interval, lastPreKey.key_id)
  await fileStore.save_prekeys(preKeys.concat(lastResortPrekey))

  await trustbasePreKeys.upload(username, `0x${sodium.to_hex(new Uint8Array(preKeysPackage.serialise()))}`)

  spinner.succeed('PreKeys uploaded')
}

module.exports = uploadPreKeys
