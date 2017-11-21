#!/usr/bin/env node
const path = require('path')
const os = require('os')

const {
  getWeb3,
  initialize: initializeTrustbase,
  Identities,
  PreKeys,
  Messages
} = require('trustbase')

const yargs = require('yargs')
const inquirer = require('inquirer')

const fs = require('fs-extra')

const hardRejection = require('hard-rejection')

hardRejection()

const register = require('./register')
const checkRegister = require('./check-register')
const info = require('./info')
const use = require('./use')
const send = require('./send')
const inbox = require('./inbox')
const replacePreKeys = require('./replace-pre-keys')

const HDWalletProvider = require('./HDWalletProvider')

const {
  input,
  list
} = require('./prompts')
const autocomplete = require('./autocomplete-prompts')

inquirer.registerPrompt('input', input)
inquirer.registerPrompt('list', list)
inquirer.registerPrompt('autocomplete', autocomplete)

const preKeysOptions = {
  'pre-key-interval': {
    alias: ['pi', 'preKeyInterval'],
    default: 1,
    number: true,
    describe: 'Interval of new pre-keys '
  },
  'pre-key-number': {
    alias: ['pn', 'preKeyNumber'],
    default: 100,
    number: true,
    describe: 'Number of new pre-keys'
  }
}

const argv = yargs
  .usage('Usage: $0 <command> [options]')
  .global('config')
  .command('register', 'Register a new account', (_yargs) => {
    _yargs
      .usage('Usage: $0 register [username] [options]')
      .string('_')
      .options({
        ...preKeysOptions
      })
  })
  .command('check-register', 'Check registration status', (_yargs) => {
    _yargs
      .usage('Usage: $0 check-register [username] [options]')
      .string('_')
      .options({
        hash: {
          alias: 'h',
          describe: 'Use transaction hash'
        },
        ...preKeysOptions
      })
  })
  .command('info', 'Get public key for a user', (_yargs) => {
    _yargs
      .usage('Usage: $0 info [username] [options]')
      .string('_')
  })
  .command('use', 'Set current using user', (_yargs) => {
    _yargs
      .usage('Usage: $0 use [username] [options]')
      .string('_')
  })
  .command('send', 'Send a message', (_yargs) => {
    _yargs
      .usage('Usage: $0 send [to] [message] [options]')
      .string('_')
      .options({
        use: {
          alias: 'u',
          describe: 'Use this keymail account'
        },
        hash: {
          alias: 'h',
          boolean: true,
          describe: 'Use hash as receiver'
        }
      })
  })
  .command('inbox', 'Check your inbox', (_yargs) => {
    _yargs
      .usage('Usage: $0 inbox [username] [options]')
      .string('_')
      .options({
        use: {
          alias: 'u',
          describe: 'Use this keymail account'
        },
        from: {
          alias: 'f',
          describe: 'Only show messages from this specified person(hash or username)'
        },
        watch: {
          alias: 'w',
          describe: 'Persistent message receiving'
        }
      })
  })
  .command('replace-pre-keys', 'Replace your pre-keys', (_yargs) => {
    _yargs
      .usage('Usage: $0 replace-pre-keys [username] [options]')
      .string('_')
      .options({
        use: {
          alias: 'u',
          describe: 'Use this keymail account'
        },
        ...preKeysOptions
      })
  })
  .recommendCommands()
  .env('KEYMAIL')
  .config()
  .options({
    identities: {
      alias: 'I',
      describe: 'Identities contract deployed address',
      string: true,
      global: true
    },
    'pre-keys': {
      alias: ['P', 'preKeys'],
      describe: 'PreKeys contract deployed address',
      string: true,
      global: true
    },
    messages: {
      alias: 'M',
      describe: 'Messages contract deployed address',
      string: true,
      global: true
    },
    provider: {
      alias: 'p',
      describe: 'RPC provider url',
      default: 'https://rinkeby.infura.io',
      // demandOption: process.env.NODE_ENV !== 'development',
      global: true
    },
    user: {
      alias: 'U',
      describe: 'Use this keymail account as default',
      string: true,
      global: true
    },
    'default-account': {
      alias: ['a', 'defaultAccount'],
      describe: 'Ethereum account address',
      string: true,
      global: true
    },
    'wallet-mnemonic': {
      alias: ['wm', 'mnemonic'],
      default: 'donkey guess rain range must chef clump obvious issue still vast ask',
      describe: 'Mnemonic for HD Wallet',
      string: true,
      global: true
    },
    'wallet-index': {
      alias: ['wi', 'index'],
      default: 0,
      number: true,
      describe: 'Index for HD Wallet',
      global: true
    },
    'storage-path': {
      alias: ['s', 'storagePath'],
      default: path.resolve(os.homedir(), '.keymail'),
      string: true,
      describe: 'Path for public/secret keys storage',
      global: true
    },
    'auto-refill': {
      alias: ['r', 'autoRefill'],
      default: true,
      boolean: true,
      describe: 'Generate and upload new pre-keys when pre-keys are not enough (see `refill-limit` also)',
      global: true
    },
    'refill-limit': {
      alias: ['rl', 'refillLimit'],
      default: 10,
      number: true,
      describe: 'Auto refill when option `auto-refill` set to `true` and pre-keys number less than the limit',
      global: true
    }
  })
  .help('h')
  .alias('h', 'help')
  .demandCommand(1, '')
  .argv

async function connectToTrustbase() {
  let provider
  if (argv.provider) {
    provider = argv.mnemonic
      ? new HDWalletProvider(argv.mnemonic, argv.provider, argv.index)
      : argv.provider
  }

  await initializeTrustbase({
    provider,
    defaultAccount: argv.defaultAccount
  })

  const trustbaseIdentities = new Identities({
    address: argv.identities
  })
  const trustbasePreKeys = new PreKeys({
    address: argv.preKeys
  })
  const trustbaseMessages = new Messages({
    address: argv.messages
  })

  const storagePath = path.resolve(process.cwd(), argv.storagePath)
  const pendingRecordPath = path.resolve(storagePath, '.pending')
  const recordPath = path.resolve(storagePath, '.record')
  const currentUserPath = path.resolve(storagePath, '.currentUser')
  await fs.ensureDir(storagePath)
  if (!await fs.exists(pendingRecordPath)) {
    await fs.ensureFile(pendingRecordPath)
    await fs.writeJSON(pendingRecordPath, {})
  }
  if (!await fs.exists(recordPath)) {
    await fs.ensureFile(recordPath)
    await fs.writeJSON(recordPath, {})
  }
  let currentUser = null
  if (await fs.exists(currentUserPath)) {
    currentUser = await fs.readFile(currentUserPath, 'utf8')
  } else {
    await fs.ensureFile(currentUserPath)
    await fs.writeJSON(currentUserPath, {})
  }
  argv.storagePath = storagePath
  argv.pendingRecordPath = pendingRecordPath
  argv.recordPath = recordPath
  argv.currentUserPath = currentUserPath
  argv.currentUser = currentUser

  return {
    argv,
    inquirer,
    trustbaseIdentities,
    trustbasePreKeys,
    trustbaseMessages,
    web3: getWeb3()
  }
}

switch (argv._[0]) {
  case 'register':
    connectToTrustbase().then(register)
    break
  case 'check-register':
    connectToTrustbase().then(checkRegister)
    break
  case 'info':
    connectToTrustbase().then(info)
    break
  case 'use':
    connectToTrustbase().then(use)
    break
  case 'send':
    connectToTrustbase().then(send)
    break
  case 'inbox':
    connectToTrustbase().then(inbox)
    break
  case 'replace-pre-keys':
    connectToTrustbase().then(replacePreKeys)
    break
  default:
    yargs.showHelp()
}
