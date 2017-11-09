const Cryptobox = require('cryptobox-hd')
const CryptoboxCRUDStore = Cryptobox.store.CryptoboxCRUDStore

class MyCRUDStore extends CryptoboxCRUDStore {
  // eslint-disable-next-line
  delete_prekey() {}
  deletePrekey(preKeyID) {
    return this.engine.delete(CryptoboxCRUDStore.STORES.PRE_KEYS, preKeyID.toString())
      .then(() => preKeyID)
  }
}

module.exports = MyCRUDStore
