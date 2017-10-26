#!/usr/bin/env node
const path = require('path')
const os = require('os')

const {
  getWeb3,
  configure: configureTrustbase,
  Trustbase,
  PreKeyStore,
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
    number: true,
    describe: 'Interval of new pre-keys '
  },
  'pre-key-number': {
    alias: ['pn', 'preKeyNumber'],
    number: true,
    describe: 'Number of new pre-keys'
  }
}

const argv = yargs
  .usage('Usage: $0 <command> [options]')
  .global('config')
  .command('register', 'Register a new account', (_yargs) => {
    _yargs
      .usage('Usage: $0 register [username]')
      .options({
        ...preKeysOptions
      })
  })
  .command('check-register', 'Check registration status', (_yargs) => {
    _yargs
      .usage('Usage: $0 check-register [options] [username]')
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
      .usage('Usage: $0 info [username]')
  })
  .command('use', 'Set current using user', (_yargs) => {
    _yargs
      .usage('Usage: $0 use [username]')
  })
  .command('send', 'Send a message', (_yargs) => {
    _yargs
      .usage('Usage: $0 send [to] [message]')
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
      .usage('Usage: $0 inbox [username]')
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
      .usage('Usage: $0 replace-pre-keys [username]')
      .options({
        use: {
          alias: 'u',
          describe: 'Use this keymail account'
        },
        from: {
          alias: 'f',
          number: true,
          default: Date.now(),
          describe: 'JavaScript timestamp, replace all pre-keys after this date'
        },
        ...preKeysOptions
      })
  })
  .recommendCommands()
  .env('KEYMAIL')
  .config()
  .options({
    trustbase: {
      alias: 'T',
      describe: 'Trustbase contract deployed address',
      string: true,
      global: true
    },
    'pre-key-store': {
      alias: ['P', 'preKeyStore'],
      describe: 'PreKeyStore contract deployed address',
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
      demandOption: process.env.NODE_ENV !== 'development',
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
      describe: 'Mnemonic for HD Wallet',
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
    }
  })
  .help('h')
  .alias('h', 'help')
  .demandCommand(1, '')
  .argv;

(async () => {
  await configureTrustbase(argv)
  const trustbase = await Trustbase.new({
    address: argv.trustbase
  })
  const preKeyStore = await PreKeyStore.new({
    address: argv.preKeyStore
  })
  const messages = await Messages.new({
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

  const handlerOptions = {
    argv,
    inquirer,
    trustbase,
    preKeyStore,
    messages,
    web3: getWeb3()
  }
  switch (argv._[0]) {
    case 'register':
      return register(handlerOptions)
    case 'check-register':
      return checkRegister(handlerOptions)
    case 'info':
      return info(handlerOptions)
    case 'use':
      return use(handlerOptions)
    case 'send':
      return send(handlerOptions)
    case 'inbox':
      return inbox(handlerOptions)
    case 'replace-pre-keys':
      return replacePreKeys(handlerOptions)
    default:
      return yargs.showHelp()
  }
})()
