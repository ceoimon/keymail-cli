const Cryptobox = require('wire-webapp-cryptobox')
const CryptoboxCRUDStore = Cryptobox.store.CryptoboxCRUDStore

class MyCRUDStore extends CryptoboxCRUDStore {
  // eslint-disable-next-line
  delete_prekey() {}
  deletePrekey(prekeyID) {
    return this.engine.delete(CryptoboxCRUDStore.STORES.PRE_KEYS, prekeyID.toString())
      .then(() => prekeyID)
  }
}

module.exports = MyCRUDStore
