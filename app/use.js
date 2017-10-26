const fs = require('fs-extra')
const ora = require('ora')

async function handleUse({
  argv,
  trustbase,
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

  if (!username) {
    ora().fail('Invalid username.')
    process.exit(1)
  }

  if (!record[username] || !await trustbase.isOwner(web3.eth.defaultAccount, username)) {
    ora().fail('Invalid username, you don\'t own this username.')
    process.exit(1)
  }

  await fs.writeFile(argv.currentUserPath, username)

  ora().succeed(`Now using: ${username}`)

  process.exit(0)
}

module.exports = handleUse
