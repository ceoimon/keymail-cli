const ora = require('ora')

const usernamePrompt = [
  {
    type: 'input',
    name: 'username',
    message: 'Username:',
    validate: val => (val ? true : 'Username cannot be empty!')
  }
]

async function handleInfo({
  argv,
  inquirer,
  trustbaseIdentities,
  web3
}) {
  const username = argv._.length > 1 ? argv._[1] : (await inquirer.prompt(usernamePrompt)).username

  if (username === '') {
    ora().fail('Invalid username')
    process.exit(1)
  }

  const {
    owner,
    publicKey: identityKeyString
  } = await trustbaseIdentities.getIdentity(username)

  if (Number(identityKeyString) === 0) {
    ora().info(`User('${username}') not found`)
  } else {
    console.log(JSON.stringify({
      username,
      usernameHash: web3.utils.sha3(username),
      owner,
      identity: identityKeyString
    }, null, '    '))
  }

  process.exit(0)
}

module.exports = handleInfo
